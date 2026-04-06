import { z } from 'zod';
import { BadRequestError } from '@longeny/errors';
import * as subscriptionService from '../services/subscription.service.js';

const createSubscriptionSchema = z.object({
  providerId: z.string().uuid(),
  programId: z.string().uuid().optional(),
  priceId: z.string().min(1),
  planName: z.string().min(1).max(200),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  interval: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  trialDays: z.number().int().min(0).optional(),
  gateway: z.enum(['stripe', 'razorpay']).default('stripe'),
});

const updateSubscriptionSchema = z.object({
  priceId: z.string().min(1).optional(),
  planName: z.string().min(1).max(200).optional(),
  quantity: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
});

const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  immediately: z.boolean().default(false),
});

export async function createSubscription({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = createSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid subscription data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await subscriptionService.createSubscription({ userId, ...parsed.data });

  set.status = 201;
  return { success: true, data: result };
}

export async function updateSubscription({ body, store, params }: any) {
  const userId = store.userId as string;
  const subscriptionId = params.id;
  const parsed = updateSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid subscription update data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const subscription = await subscriptionService.updateSubscription(subscriptionId, userId, parsed.data);
  return { success: true, data: subscription };
}

export async function listSubscriptions({ store, query }: any) {
  const userId = store.userId as string;

  const result = await subscriptionService.listSubscriptions(userId, {
    status: query.status,
    page: query.page ? parseInt(query.page) : undefined,
    limit: query.limit ? parseInt(query.limit) : undefined,
  });

  return {
    success: true,
    data: result.subscriptions,
    pagination: result.pagination,
  };
}

export async function getSubscriptionDetail({ store, params }: any) {
  const userId = store.userId as string;
  const subscriptionId = params.id;

  const subscription = await subscriptionService.getSubscriptionDetail(subscriptionId, userId);
  return { success: true, data: subscription };
}

export async function cancelSubscription({ body, store, params }: any) {
  const userId = store.userId as string;
  const subscriptionId = params.id;
  const parsed = cancelSubscriptionSchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new BadRequestError('Invalid cancellation data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const subscription = await subscriptionService.cancelSubscription(
    subscriptionId,
    userId,
    parsed.data.reason,
    parsed.data.immediately,
  );

  return { success: true, data: subscription };
}
