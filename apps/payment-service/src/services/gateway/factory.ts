import { loadConfig, paymentConfigSchema } from '@longeny/config';
import { BadRequestError } from '@longeny/errors';
import type { PaymentGateway } from './index.js';
import { StripeGateway } from './stripe.gateway.js';
import { RazorpayGateway } from './razorpay.gateway.js';

const config = loadConfig(paymentConfigSchema);

let stripeGateway: StripeGateway | null = null;
let razorpayGateway: RazorpayGateway | null = null;

export function createPaymentGateway(gateway: 'stripe' | 'razorpay'): PaymentGateway {
  switch (gateway) {
    case 'stripe':
      if (!stripeGateway) {
        stripeGateway = new StripeGateway(config.STRIPE_SECRET_KEY);
      }
      return stripeGateway;

    case 'razorpay':
      if (!razorpayGateway) {
        razorpayGateway = new RazorpayGateway(
          config.RAZORPAY_KEY_ID,
          config.RAZORPAY_KEY_SECRET,
        );
      }
      return razorpayGateway;

    default:
      throw new BadRequestError(`Unsupported payment gateway: ${gateway}`);
  }
}

/**
 * Get the Stripe gateway instance directly (for webhook handling
 * which needs the Stripe-specific constructWebhookEvent method).
 */
export function getStripeGateway(): StripeGateway {
  if (!stripeGateway) {
    stripeGateway = new StripeGateway(config.STRIPE_SECRET_KEY);
  }
  return stripeGateway;
}

/**
 * Get the Razorpay gateway instance directly (for webhook handling).
 */
export function getRazorpayGateway(): RazorpayGateway {
  if (!razorpayGateway) {
    razorpayGateway = new RazorpayGateway(
      config.RAZORPAY_KEY_ID,
      config.RAZORPAY_KEY_SECRET,
    );
  }
  return razorpayGateway;
}
