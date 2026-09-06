import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createCheckoutSchema = z.object({
  providerId: uuidSchema,
  bookingId: uuidSchema.optional(),
  orderType: z.enum(['session', 'program', 'product', 'subscription']),
  currency: z.string().length(3).default('USD'),
  items: z
    .array(
      z.object({
        entityType: z.enum(['session', 'program', 'product']),
        entityId: uuidSchema,
        description: z.string().min(1).max(500),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive(),
      }),
    )
    .min(1),
  platformFeePercent: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  gateway: z.enum(['stripe', 'razorpay']).default('stripe'),
  notes: z.string().optional(),
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
  reason: z.string().min(1).max(1000),
  amount: z.number().positive().optional(),
});

/**
 * Order line item. The controllers own the business rules; these schemas are the
 * one description of the wire format, used by both the route validator and the
 * controller's own parse.
 */
const orderItemSchema = z.object({
  entityType: z.enum(['session', 'program', 'product']),
  entityId: uuidSchema,
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

export const createOrderSchema = z.object({
  providerId: uuidSchema,
  bookingId: uuidSchema.optional(),
  orderType: z.enum(['session', 'program', 'product', 'subscription']),
  currency: z.string().length(3).default('USD'),
  items: z.array(orderItemSchema).min(1),
  platformFeePercent: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const payOrderSchema = z.object({
  gateway: z.enum(['stripe', 'razorpay']).default('stripe'),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const createPaymentIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  gateway: z.enum(['stripe', 'razorpay']).default('stripe'),
  metadata: z.record(z.string()).optional(),
});

export const createSetupIntentSchema = z.object({
  gateway: z.enum(['stripe', 'razorpay']).default('stripe'),
});

export const updateSubscriptionSchema = z.object({
  planId: uuidSchema.optional(),
  interval: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  metadata: z.record(z.string()).optional(),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(1000).optional(),
  cancelAtPeriodEnd: z.boolean().default(true),
});
