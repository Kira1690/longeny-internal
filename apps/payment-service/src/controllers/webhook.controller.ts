import { BadRequestError } from '@longeny/errors';
import * as webhookService from '../services/webhook.service.js';

/**
 * Stripe webhook handler.
 * IMPORTANT: Uses raw body (request.text()) for signature verification.
 * These routes must NOT have JSON body parser middleware applied.
 */
export async function stripeWebhook({ request, set }: any) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    throw new BadRequestError('Missing stripe-signature header');
  }

  const rawBody = await request.text();
  if (!rawBody) {
    throw new BadRequestError('Empty request body');
  }

  await webhookService.processStripeWebhook(rawBody, signature);

  return { received: true };
}

/**
 * Razorpay webhook handler.
 * Uses raw body for signature verification.
 */
export async function razorpayWebhook({ request, set }: any) {
  const signature = request.headers.get('x-razorpay-signature');
  if (!signature) {
    throw new BadRequestError('Missing x-razorpay-signature header');
  }

  const rawBody = await request.text();
  if (!rawBody) {
    throw new BadRequestError('Empty request body');
  }

  await webhookService.processRazorpayWebhook(rawBody, signature);

  return { received: true };
}
