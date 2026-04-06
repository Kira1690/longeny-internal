import { db } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { subscriptions, gateway_customers } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import { NotFoundError, BadRequestError } from '@longeny/errors';
import { createPaymentGateway } from './gateway/factory.js';
import { publishSubscriptionCreated, publishSubscriptionCancelled } from '../events/publishers.js';

const logger = createLogger('payment-service:subscription');

export interface CreateSubscriptionInput {
  userId: string;
  providerId: string;
  programId?: string;
  priceId: string;
  planName: string;
  amount: number;
  currency?: string;
  interval?: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  trialDays?: number;
  gateway?: 'stripe' | 'razorpay';
}

export async function createSubscription(input: CreateSubscriptionInput) {
  const {
    userId,
    providerId,
    programId,
    priceId,
    planName,
    amount,
    currency = 'USD',
    interval = 'monthly',
    trialDays,
    gateway = 'stripe',
  } = input;

  const paymentGateway = createPaymentGateway(gateway);

  // Ensure gateway customer exists
  let [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    const { customerId } = await paymentGateway.createCustomer(
      `user-${userId}@longeny.com`,
      `user-${userId}`,
    );
    [gatewayCustomer] = await db.insert(gateway_customers).values({
      user_id: userId,
      payment_gateway: gateway,
      gateway_customer_id: customerId,
    }).returning();
  }

  const result = await paymentGateway.createSubscription({
    customerId: gatewayCustomer.gateway_customer_id,
    priceId,
    trialDays,
  });

  const [subscription] = await db.insert(subscriptions).values({
    user_id: userId,
    provider_id: providerId,
    program_id: programId || null,
    gateway_subscription_id: result.subscriptionId,
    gateway_price_id: priceId,
    plan_name: planName,
    amount: amount.toString(),
    currency,
    interval,
    status: trialDays ? 'trialing' : 'active',
    current_period_start: result.currentPeriodStart,
    current_period_end: result.currentPeriodEnd,
    trial_end: result.trialEnd,
  }).returning();

  logger.info({ subscriptionId: subscription.id, userId }, 'Subscription created');

  await publishSubscriptionCreated({
    subscriptionId: subscription.id,
    userId,
    providerId,
    programId: programId || null,
    planName,
    amount,
    currency,
    interval,
  });

  return {
    subscription,
    clientSecret: result.clientSecret,
  };
}

export interface UpdateSubscriptionInput {
  priceId?: string;
  planName?: string;
  quantity?: number;
  amount?: number;
}

export async function updateSubscription(
  subscriptionId: string,
  userId: string,
  input: UpdateSubscriptionInput,
) {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);

  if (!subscription) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  if (subscription.user_id !== userId) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  if (subscription.status === 'cancelled') {
    throw new BadRequestError('Cannot update a cancelled subscription');
  }

  if (!subscription.gateway_subscription_id) {
    throw new BadRequestError('Subscription has no gateway reference');
  }

  const gateway: 'stripe' | 'razorpay' = subscription.gateway_subscription_id.startsWith('sub_')
    ? 'stripe'
    : 'razorpay';

  const paymentGateway = createPaymentGateway(gateway);
  await paymentGateway.updateSubscription(subscription.gateway_subscription_id, {
    priceId: input.priceId,
    quantity: input.quantity,
  });

  const updateData: Record<string, unknown> = { updated_at: new Date() };
  if (input.priceId) updateData.gateway_price_id = input.priceId;
  if (input.planName) updateData.plan_name = input.planName;
  if (input.amount !== undefined) updateData.amount = input.amount.toString();

  const [updated] = await db.update(subscriptions).set(updateData as any).where(eq(subscriptions.id, subscriptionId)).returning();

  logger.info({ subscriptionId, gateway }, 'Subscription updated');
  return updated;
}

export async function listSubscriptions(
  userId: string,
  filters: { status?: string; page?: number; limit?: number },
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  const whereClause = filters.status
    ? and(eq(subscriptions.user_id, userId), eq(subscriptions.status, filters.status as any))
    : eq(subscriptions.user_id, userId);

  const [subscriptionList, [{ count }]] = await Promise.all([
    db.select().from(subscriptions).where(whereClause).limit(limit).offset(offset).orderBy(subscriptions.created_at),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(subscriptions).where(whereClause),
  ]);

  const total = count;
  const totalPages = Math.ceil(total / limit);

  return {
    subscriptions: subscriptionList,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

export async function getSubscriptionDetail(subscriptionId: string, userId: string) {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);

  if (!subscription) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  if (subscription.user_id !== userId) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  return subscription;
}

export async function cancelSubscription(
  subscriptionId: string,
  userId: string,
  reason?: string,
  immediately = false,
) {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);

  if (!subscription) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  if (subscription.user_id !== userId) {
    throw new NotFoundError('Subscription', subscriptionId);
  }

  if (subscription.status === 'cancelled') {
    throw new BadRequestError('Subscription is already cancelled');
  }

  if (subscription.gateway_subscription_id) {
    const gateway: 'stripe' | 'razorpay' = subscription.gateway_subscription_id.startsWith('sub_')
      ? 'stripe'
      : 'razorpay';

    const paymentGateway = createPaymentGateway(gateway);
    await paymentGateway.cancelSubscription(subscription.gateway_subscription_id, immediately);
  }

  const [updated] = await db.update(subscriptions).set({
    status: immediately ? 'cancelled' : subscription.status,
    cancel_at_period_end: !immediately,
    cancelled_at: immediately ? new Date() : null,
    cancellation_reason: reason || null,
    updated_at: new Date(),
  }).where(eq(subscriptions.id, subscriptionId)).returning();

  logger.info({ subscriptionId, immediately }, 'Subscription cancellation processed');

  await publishSubscriptionCancelled({
    subscriptionId: subscription.id,
    userId: subscription.user_id,
    providerId: subscription.provider_id,
    programId: subscription.program_id,
    planName: subscription.plan_name,
    immediately,
  });

  return updated;
}

export async function syncSubscriptionStatus(
  gatewaySubscriptionId: string,
  status: string,
  currentPeriodStart?: number,
  currentPeriodEnd?: number,
  cancelAtPeriodEnd?: boolean,
) {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.gateway_subscription_id, gatewaySubscriptionId))
    .limit(1);

  if (!subscription) {
    logger.warn({ gatewaySubscriptionId }, 'Subscription not found for sync');
    return;
  }

  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    canceled: 'cancelled',
    cancelled: 'cancelled',
    paused: 'paused',
    incomplete: 'active',
    incomplete_expired: 'cancelled',
    unpaid: 'past_due',
    // Razorpay statuses
    created: 'active',
    authenticated: 'active',
    halted: 'past_due',
    completed: 'cancelled',
    expired: 'cancelled',
  };

  const mappedStatus = statusMap[status] || subscription.status;

  const updateData: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: new Date(),
  };

  if (currentPeriodStart) updateData.current_period_start = new Date(currentPeriodStart * 1000);
  if (currentPeriodEnd) updateData.current_period_end = new Date(currentPeriodEnd * 1000);
  if (cancelAtPeriodEnd !== undefined) updateData.cancel_at_period_end = cancelAtPeriodEnd;
  if (mappedStatus === 'cancelled') updateData.cancelled_at = new Date();

  await db.update(subscriptions).set(updateData as any).where(eq(subscriptions.id, subscription.id));

  logger.info({ subscriptionId: subscription.id, status: mappedStatus }, 'Subscription status synced');
}

export async function handleSubscriptionDeleted(gatewaySubscriptionId: string) {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.gateway_subscription_id, gatewaySubscriptionId))
    .limit(1);

  if (!subscription) {
    logger.warn({ gatewaySubscriptionId }, 'Subscription not found for deletion');
    return;
  }

  await db.update(subscriptions).set({
    status: 'cancelled',
    cancelled_at: new Date(),
    updated_at: new Date(),
  }).where(eq(subscriptions.id, subscription.id));

  logger.info({ subscriptionId: subscription.id }, 'Subscription marked as cancelled (deleted)');

  await publishSubscriptionCancelled({
    subscriptionId: subscription.id,
    userId: subscription.user_id,
    providerId: subscription.provider_id,
    programId: subscription.program_id,
    planName: subscription.plan_name,
    immediately: true,
  });
}
