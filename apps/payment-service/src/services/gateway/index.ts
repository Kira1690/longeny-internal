// ─────────────────────────────────────────────────────────────
// Payment Gateway Interface (Strategy Pattern)
// ─────────────────────────────────────────────────────────────

export interface CheckoutParams {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  customerId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionParams {
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export interface PaymentIntentParams {
  amount: number;
  currency: string;
  customerId: string;
  metadata?: Record<string, string>;
}

export interface PaymentGateway {
  readonly name: 'stripe' | 'razorpay';

  createCustomer(email: string, name: string): Promise<{ customerId: string }>;

  createCheckoutSession(params: CheckoutParams): Promise<{ sessionId: string; url: string }>;

  createSubscription(params: SubscriptionParams): Promise<{
    subscriptionId: string;
    clientSecret: string | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    trialEnd: Date | null;
    status: string;
  }>;

  updateSubscription(subscriptionId: string, params: { priceId?: string; quantity?: number }): Promise<{
    subscriptionId: string;
    status: string;
  }>;

  cancelSubscription(subscriptionId: string, immediately?: boolean): Promise<void>;

  createRefund(paymentId: string, amount?: number): Promise<{ refundId: string }>;

  verifyWebhookSignature(body: string, signature: string, secret: string): boolean;

  createPaymentIntent(params: PaymentIntentParams): Promise<{ intentId: string; clientSecret: string }>;

  createSetupIntent(customerId: string): Promise<{ intentId: string; clientSecret: string }>;

  listPaymentMethods(customerId: string): Promise<Array<{
    id: string;
    type: string;
    card: {
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
    } | null;
  }>>;

  detachPaymentMethod(paymentMethodId: string): Promise<void>;
}

export { createPaymentGateway } from './factory.js';
export { StripeGateway } from './stripe.gateway.js';
export { RazorpayGateway } from './razorpay.gateway.js';
