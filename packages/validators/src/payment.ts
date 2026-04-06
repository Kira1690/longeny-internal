import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createCheckoutSchema = z.object({
  orderType: z.enum(['session', 'program', 'product', 'subscription']),
  itemId: uuidSchema,
  quantity: z.number().int().positive().default(1),
  currency: z.string().length(3).default('USD'),
  paymentGateway: z.enum(['stripe', 'razorpay']).default('stripe'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string()).optional(),
});

export const createSubscriptionSchema = z.object({
  planId: uuidSchema,
  paymentGateway: z.enum(['stripe', 'razorpay']).default('stripe'),
  interval: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  trialDays: z.number().int().nonnegative().max(90).optional(),
  metadata: z.record(z.string()).optional(),
});

export const requestRefundSchema = z.object({
  orderId: uuidSchema,
  reason: z.string().min(1).max(2000),
  amount: z.number().positive().optional(),
});
