import { db } from '../db/index.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { orders, order_items, payments, refunds, gateway_customers, invoices } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import { NotFoundError, BadRequestError } from '@longeny/errors';
import { createPaymentGateway } from './gateway/factory.js';
import { publishPaymentCompleted, publishPaymentFailed } from '../events/publishers.js';

const logger = createLogger('payment-service:payment');

function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `ORD-${date}-${random}`;
}

export interface CreateOrderInput {
  userId: string;
  providerId: string;
  bookingId?: string;
  orderType: 'session' | 'program' | 'product' | 'subscription';
  currency?: string;
  items: Array<{
    entityType: 'session' | 'program' | 'product';
    entityId: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  platformFeePercent?: number;
  taxRate?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export async function createOrder(input: CreateOrderInput) {
  const {
    userId,
    providerId,
    bookingId,
    orderType,
    items,
    currency = 'USD',
    platformFeePercent = 10,
    taxRate = 0,
    notes,
    metadata,
  } = input;

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = parseFloat((subtotal * (taxRate / 100)).toFixed(2));
  const platformFee = parseFloat((subtotal * (platformFeePercent / 100)).toFixed(2));
  const discount = 0;
  const total = parseFloat((subtotal + tax - discount).toFixed(2));

  const [order] = await db.insert(orders).values({
    order_number: generateOrderNumber(),
    user_id: userId,
    provider_id: providerId,
    booking_id: bookingId || null,
    order_type: orderType,
    status: 'pending',
    subtotal: subtotal.toString(),
    tax: tax.toString(),
    platform_fee: platformFee.toString(),
    platform_fee_percent: platformFeePercent.toString(),
    discount: discount.toString(),
    total: total.toString(),
    currency,
    notes: notes || null,
    metadata: metadata || null,
  }).returning();

  await db.insert(order_items).values(
    items.map((item) => ({
      order_id: order.id,
      entity_type: item.entityType,
      entity_id: item.entityId,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice.toString(),
      total_price: parseFloat((item.unitPrice * item.quantity).toFixed(2)).toString(),
    })),
  );

  const orderItems = await db.select().from(order_items).where(eq(order_items.order_id, order.id));

  logger.info({ orderId: order.id, orderNumber: order.order_number }, 'Order created');
  return { ...order, items: orderItems };
}

export async function processCheckout(
  orderId: string,
  userId: string,
  gateway: 'stripe' | 'razorpay',
  successUrl: string,
  cancelUrl: string,
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    throw new NotFoundError('Order', orderId);
  }

  if (order.user_id !== userId) {
    throw new BadRequestError('Order does not belong to user');
  }

  if (order.status !== 'pending') {
    throw new BadRequestError(`Cannot checkout order with status: ${order.status}`);
  }

  const orderItemsList = await db.select().from(order_items).where(eq(order_items.order_id, orderId));

  const paymentGateway = createPaymentGateway(gateway);

  // Ensure customer exists
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

  const session = await paymentGateway.createCheckoutSession({
    orderId: order.id,
    orderNumber: order.order_number,
    amount: Number(order.total),
    currency: order.currency,
    customerId: gatewayCustomer.gateway_customer_id,
    items: orderItemsList.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unit_price),
    })),
    successUrl,
    cancelUrl,
  });

  await db.update(orders).set({
    payment_gateway: gateway,
    gateway_checkout_session_id: session.sessionId,
    updated_at: new Date(),
  }).where(eq(orders.id, orderId));

  return { checkoutUrl: session.url, sessionId: session.sessionId };
}

export async function payOrder(
  orderId: string,
  userId: string,
  gateway: 'stripe' | 'razorpay',
  successUrl: string,
  cancelUrl: string,
) {
  return processCheckout(orderId, userId, gateway, successUrl, cancelUrl);
}

export async function createPaymentIntent(
  userId: string,
  amount: number,
  currency: string,
  gateway: 'stripe' | 'razorpay',
  metadata?: Record<string, string>,
) {
  const paymentGateway = createPaymentGateway(gateway);

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

  return paymentGateway.createPaymentIntent({
    amount,
    currency,
    customerId: gatewayCustomer.gateway_customer_id,
    metadata: { userId, ...metadata },
  });
}

export async function createSetupIntent(
  userId: string,
  gateway: 'stripe' | 'razorpay',
) {
  const paymentGateway = createPaymentGateway(gateway);

  const [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    throw new BadRequestError('No payment customer found. Complete a checkout first.');
  }

  return paymentGateway.createSetupIntent(gatewayCustomer.gateway_customer_id);
}

export async function approveRefund(refundId: string, approvedBy: string) {
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);

  if (!refund) {
    throw new NotFoundError('Refund', refundId);
  }

  if (refund.status !== 'pending') {
    throw new BadRequestError(`Cannot approve refund with status: ${refund.status}`);
  }

  const [payment] = await db.select().from(payments).where(eq(payments.id, refund.payment_id)).limit(1);
  const [order] = await db.select().from(orders).where(eq(orders.id, refund.order_id)).limit(1);

  // Mark as approved
  await db.update(refunds).set({
    status: 'approved',
    approved_by: approvedBy,
    approved_at: new Date(),
    updated_at: new Date(),
  }).where(eq(refunds.id, refundId));

  const gateway = (order.payment_gateway as 'stripe' | 'razorpay') || 'stripe';

  if (payment?.gateway_payment_id) {
    try {
      await db.update(refunds).set({ status: 'processing', updated_at: new Date() }).where(eq(refunds.id, refundId));

      const paymentGateway = createPaymentGateway(gateway);
      const { refundId: gatewayRefundId } = await paymentGateway.createRefund(
        payment.gateway_payment_id,
        Number(refund.amount),
      );

      const [updated] = await db.update(refunds).set({
        status: 'completed',
        gateway_refund_id: gatewayRefundId,
        processed_at: new Date(),
        updated_at: new Date(),
      }).where(eq(refunds.id, refundId)).returning();

      // Update order status if fully refunded
      const completedRefunds = await db
        .select()
        .from(refunds)
        .where(and(eq(refunds.order_id, refund.order_id), eq(refunds.status, 'completed')));

      const totalRefunded = completedRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
      if (totalRefunded >= Number(order.total)) {
        await db.update(orders).set({ status: 'refunded', updated_at: new Date() }).where(eq(orders.id, refund.order_id));
      }

      logger.info({ refundId, gatewayRefundId }, 'Refund approved and processed');
      return updated;
    } catch (error) {
      await db.update(refunds).set({
        status: 'rejected',
        rejection_reason: 'Gateway processing failed',
        updated_at: new Date(),
      }).where(eq(refunds.id, refundId));
      logger.error({ error, refundId }, 'Refund processing failed');
      throw error;
    }
  }

  logger.info({ refundId }, 'Refund approved (no gateway payment to process)');
  return refund;
}

export async function handlePaymentSuccess(
  orderId: string,
  gatewayPaymentId: string,
  chargeId?: string,
  receiptUrl?: string,
  cardLast4?: string,
  cardBrand?: string,
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) {
    logger.warn({ orderId }, 'Order not found for payment success');
    return;
  }

  if (order.status === 'paid') {
    logger.info({ orderId }, 'Order already paid, skipping');
    return;
  }

  const [updatedOrder] = await db.update(orders).set({
    status: 'paid',
    gateway_payment_intent_id: gatewayPaymentId,
    paid_at: new Date(),
    updated_at: new Date(),
  }).where(eq(orders.id, orderId)).returning();

  await db.insert(payments).values({
    order_id: orderId,
    gateway_payment_id: gatewayPaymentId,
    gateway_charge_id: chargeId || null,
    amount: order.total,
    currency: order.currency,
    status: 'succeeded',
    payment_method: 'card',
    card_last_four: cardLast4 || null,
    card_brand: cardBrand || null,
    receipt_url: receiptUrl || null,
    paid_at: new Date(),
  });

  logger.info({ orderId, gatewayPaymentId }, 'Payment success processed');

  await publishPaymentCompleted({
    orderId: order.id,
    orderNumber: order.order_number,
    userId: order.user_id,
    providerId: order.provider_id,
    bookingId: order.booking_id,
    amount: Number(order.total),
    currency: order.currency,
    gateway: order.payment_gateway || 'stripe',
  });

  return updatedOrder;
}

export async function handlePaymentFailure(
  orderId: string,
  failureCode?: string,
  failureMessage?: string,
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) {
    logger.warn({ orderId }, 'Order not found for payment failure');
    return;
  }

  await db.insert(payments).values({
    order_id: orderId,
    amount: order.total,
    currency: order.currency,
    status: 'failed',
    failure_code: failureCode || null,
    failure_message: failureMessage || null,
  });

  logger.info({ orderId, failureCode }, 'Payment failure processed');

  await publishPaymentFailed({
    orderId: order.id,
    orderNumber: order.order_number,
    userId: order.user_id,
    providerId: order.provider_id,
    bookingId: order.booking_id,
    amount: Number(order.total),
    currency: order.currency,
    error: failureMessage || 'Payment failed',
  });
}

export async function listOrders(
  userId: string,
  filters: {
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  },
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  const whereClause = filters.status
    ? and(eq(orders.user_id, userId), eq(orders.status, filters.status as any))
    : eq(orders.user_id, userId);

  const [orderList, [{ count }]] = await Promise.all([
    db.select().from(orders).where(whereClause).limit(limit).offset(offset).orderBy(orders.created_at),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(orders).where(whereClause),
  ]);

  const orderIds = orderList.map((o) => o.id);
  const itemsList = orderIds.length
    ? await db.select().from(order_items).where(inArray(order_items.order_id, orderIds))
    : [];

  const ordersWithItems = orderList.map((o) => ({
    ...o,
    items: itemsList.filter((i) => i.order_id === o.id),
  }));

  const total = count;
  const totalPages = Math.ceil(total / limit);

  return {
    orders: ordersWithItems,
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

export async function getOrderDetail(orderId: string, userId?: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    throw new NotFoundError('Order', orderId);
  }

  if (userId && order.user_id !== userId) {
    throw new NotFoundError('Order', orderId);
  }

  const [orderItemsList, paymentsList, refundsList, [invoice]] = await Promise.all([
    db.select().from(order_items).where(eq(order_items.order_id, orderId)),
    db.select().from(payments).where(eq(payments.order_id, orderId)),
    db.select().from(refunds).where(eq(refunds.order_id, orderId)),
    db.select().from(invoices).where(eq(invoices.order_id, orderId)).limit(1),
  ]);

  return {
    ...order,
    items: orderItemsList,
    payments: paymentsList,
    refunds: refundsList,
    invoice: invoice || null,
  };
}

export async function getOrCreateGatewayCustomer(
  userId: string,
  email: string,
  gateway: 'stripe' | 'razorpay' = 'stripe',
) {
  let [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    const paymentGateway = createPaymentGateway(gateway);
    const { customerId } = await paymentGateway.createCustomer(email, `user-${userId}`);
    [gatewayCustomer] = await db.insert(gateway_customers).values({
      user_id: userId,
      payment_gateway: gateway,
      gateway_customer_id: customerId,
    }).returning();
  }

  return gatewayCustomer;
}

export async function listPaymentMethods(userId: string, gateway: 'stripe' | 'razorpay' = 'stripe') {
  const [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    return [];
  }

  const paymentGateway = createPaymentGateway(gateway);
  return paymentGateway.listPaymentMethods(gatewayCustomer.gateway_customer_id);
}

export async function addPaymentMethod(userId: string, gateway: 'stripe' | 'razorpay' = 'stripe') {
  const [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    throw new BadRequestError('No payment customer found. Complete a checkout first.');
  }

  const paymentGateway = createPaymentGateway(gateway);
  const result = await paymentGateway.createSetupIntent(gatewayCustomer.gateway_customer_id);

  return {
    clientSecret: result.clientSecret,
    setupIntentId: result.intentId,
  };
}

export async function removePaymentMethod(
  userId: string,
  paymentMethodId: string,
  gateway: 'stripe' | 'razorpay' = 'stripe',
) {
  const [gatewayCustomer] = await db
    .select()
    .from(gateway_customers)
    .where(and(eq(gateway_customers.user_id, userId), eq(gateway_customers.payment_gateway, gateway)))
    .limit(1);

  if (!gatewayCustomer) {
    throw new BadRequestError('No payment customer found');
  }

  const paymentGateway = createPaymentGateway(gateway);

  const methods = await paymentGateway.listPaymentMethods(gatewayCustomer.gateway_customer_id);
  const method = methods.find((m) => m.id === paymentMethodId);
  if (!method) {
    throw new NotFoundError('PaymentMethod', paymentMethodId);
  }

  await paymentGateway.detachPaymentMethod(paymentMethodId);
  return { success: true };
}

export async function getProviderEarnings(providerId: string) {
  const paidOrders = await db
    .select({
      total: orders.total,
      platform_fee: orders.platform_fee,
      status: orders.status,
      paid_at: orders.paid_at,
    })
    .from(orders)
    .where(and(eq(orders.provider_id, providerId), inArray(orders.status, ['paid', 'fulfilled'])));

  const totalEarnings = paidOrders.reduce(
    (sum, order) => sum + Number(order.total) - Number(order.platform_fee),
    0,
  );

  const pendingEarnings = paidOrders
    .filter((o) => o.status === 'paid')
    .reduce((sum, order) => sum + Number(order.total) - Number(order.platform_fee), 0);

  const paidOutEarnings = paidOrders
    .filter((o) => o.status === 'fulfilled')
    .reduce((sum, order) => sum + Number(order.total) - Number(order.platform_fee), 0);

  // Get completed refunds for this provider's orders
  const providerOrderIds = (
    await db.select({ id: orders.id }).from(orders).where(eq(orders.provider_id, providerId))
  ).map((o) => o.id);

  const completedRefunds = providerOrderIds.length
    ? await db
        .select({ amount: refunds.amount })
        .from(refunds)
        .where(and(inArray(refunds.order_id, providerOrderIds), eq(refunds.status, 'completed')))
    : [];

  const totalRefunded = completedRefunds.reduce((sum, r) => sum + Number(r.amount), 0);

  return {
    total: parseFloat(totalEarnings.toFixed(2)),
    pending: parseFloat(pendingEarnings.toFixed(2)),
    paid: parseFloat(paidOutEarnings.toFixed(2)),
    refunded: parseFloat(totalRefunded.toFixed(2)),
    net: parseFloat((totalEarnings - totalRefunded).toFixed(2)),
    orderCount: paidOrders.length,
  };
}

export async function getProviderPayouts(
  providerId: string,
  filters: { page?: number; limit?: number },
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  const whereClause = and(eq(orders.provider_id, providerId), eq(orders.status, 'fulfilled'));

  const [orderList, [{ count }]] = await Promise.all([
    db
      .select({
        id: orders.id,
        order_number: orders.order_number,
        total: orders.total,
        platform_fee: orders.platform_fee,
        currency: orders.currency,
        paid_at: orders.paid_at,
        updated_at: orders.updated_at,
      })
      .from(orders)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(orders.updated_at),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(orders).where(whereClause),
  ]);

  const total = count;
  const totalPages = Math.ceil(total / limit);

  const payoutsList = orderList.map((order) => ({
    orderId: order.id,
    orderNumber: order.order_number,
    grossAmount: Number(order.total),
    platformFee: Number(order.platform_fee),
    netAmount: parseFloat((Number(order.total) - Number(order.platform_fee)).toFixed(2)),
    currency: order.currency,
    paidAt: order.paid_at,
    settledAt: order.updated_at,
  }));

  return {
    payouts: payoutsList,
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
