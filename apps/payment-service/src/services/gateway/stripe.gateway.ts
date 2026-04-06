import Stripe from 'stripe';
import { createLogger } from '@longeny/utils';
import { InternalError, BadRequestError } from '@longeny/errors';
import type {
  PaymentGateway,
  CheckoutParams,
  SubscriptionParams,
  PaymentIntentParams,
} from './index.js';

const logger = createLogger('payment-service:stripe-gateway');

export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe' as const;
  private stripe: Stripe;

  constructor(secretKey: string) {
    if (!secretKey) {
      throw new InternalError('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-11-20.acacia' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }

  async createCustomer(email: string, name: string): Promise<{ customerId: string }> {
    try {
      const customer = await this.stripe.customers.create({
        email,
        metadata: { name },
      });
      logger.info({ customerId: customer.id }, 'Stripe customer created');
      return { customerId: customer.id };
    } catch (error) {
      logger.error({ error }, 'Failed to create Stripe customer');
      throw new InternalError('Failed to create payment customer');
    }
  }

  async createCheckoutSession(params: CheckoutParams): Promise<{ sessionId: string; url: string }> {
    try {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = params.items.map((item) => ({
        price_data: {
          currency: params.currency.toLowerCase(),
          product_data: { name: item.description },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.quantity,
      }));

      const session = await this.stripe.checkout.sessions.create({
        customer: params.customerId,
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: {
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          ...params.metadata,
        },
      });

      logger.info({ orderId: params.orderId, sessionId: session.id }, 'Checkout session created');
      return { sessionId: session.id, url: session.url! };
    } catch (error) {
      logger.error({ error, orderId: params.orderId }, 'Failed to create checkout session');
      throw new InternalError('Failed to create checkout session');
    }
  }

  async createSubscription(params: SubscriptionParams) {
    try {
      const stripeParams: Stripe.SubscriptionCreateParams = {
        customer: params.customerId,
        items: [{ price: params.priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata: params.metadata,
      };

      if (params.trialDays && params.trialDays > 0) {
        stripeParams.trial_period_days = params.trialDays;
      }

      const subscription = await this.stripe.subscriptions.create(stripeParams);
      logger.info({ subscriptionId: subscription.id }, 'Stripe subscription created');

      return {
        subscriptionId: subscription.id,
        clientSecret: (subscription.latest_invoice as any)?.payment_intent?.client_secret || null,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        status: subscription.status,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create Stripe subscription');
      throw new InternalError('Failed to create subscription');
    }
  }

  async updateSubscription(subscriptionId: string, params: { priceId?: string; quantity?: number }) {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const updateParams: Stripe.SubscriptionUpdateParams = {};

      if (params.priceId) {
        updateParams.items = [{
          id: subscription.items.data[0]?.id,
          price: params.priceId,
        }];
      }

      if (params.quantity !== undefined) {
        updateParams.items = [{
          id: subscription.items.data[0]?.id,
          quantity: params.quantity,
          ...(params.priceId ? { price: params.priceId } : {}),
        }];
      }

      const updated = await this.stripe.subscriptions.update(subscriptionId, updateParams);
      logger.info({ subscriptionId }, 'Stripe subscription updated');

      return {
        subscriptionId: updated.id,
        status: updated.status,
      };
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to update Stripe subscription');
      throw new InternalError('Failed to update subscription');
    }
  }

  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    try {
      if (immediately) {
        await this.stripe.subscriptions.cancel(subscriptionId);
        logger.info({ subscriptionId }, 'Stripe subscription cancelled immediately');
      } else {
        await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
        logger.info({ subscriptionId }, 'Stripe subscription set to cancel at period end');
      }
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to cancel Stripe subscription');
      throw new InternalError('Failed to cancel subscription');
    }
  }

  async createRefund(paymentIntentId: string, amount?: number): Promise<{ refundId: string }> {
    try {
      const params: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
      };
      if (amount !== undefined) {
        params.amount = Math.round(amount * 100);
      }

      const refund = await this.stripe.refunds.create(params);
      logger.info({ refundId: refund.id, paymentIntentId }, 'Stripe refund created');
      return { refundId: refund.id };
    } catch (error) {
      logger.error({ error, paymentIntentId }, 'Failed to create Stripe refund');
      throw new InternalError('Failed to process refund');
    }
  }

  verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(body, signature, secret);
      return true;
    } catch {
      return false;
    }
  }

  constructWebhookEvent(body: string, signature: string, secret: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(body, signature, secret);
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification failed');
      throw new BadRequestError('Invalid webhook signature');
    }
  }

  async createPaymentIntent(params: PaymentIntentParams): Promise<{ intentId: string; clientSecret: string }> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(params.amount * 100),
        currency: params.currency.toLowerCase(),
        customer: params.customerId,
        metadata: params.metadata,
        automatic_payment_methods: { enabled: true },
      });
      logger.info({ paymentIntentId: paymentIntent.id }, 'Payment intent created');
      return { intentId: paymentIntent.id, clientSecret: paymentIntent.client_secret! };
    } catch (error) {
      logger.error({ error }, 'Failed to create payment intent');
      throw new InternalError('Failed to create payment intent');
    }
  }

  async createSetupIntent(customerId: string): Promise<{ intentId: string; clientSecret: string }> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });
      logger.info({ setupIntentId: setupIntent.id, customerId }, 'Setup intent created');
      return { intentId: setupIntent.id, clientSecret: setupIntent.client_secret! };
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to create setup intent');
      throw new InternalError('Failed to create setup intent');
    }
  }

  async listPaymentMethods(customerId: string) {
    try {
      const methods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });
      return methods.data.map((m) => ({
        id: m.id,
        type: m.type,
        card: m.card
          ? {
              brand: m.card.brand,
              last4: m.card.last4,
              exp_month: m.card.exp_month,
              exp_year: m.card.exp_year,
            }
          : null,
      }));
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to list payment methods');
      throw new InternalError('Failed to list payment methods');
    }
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      await this.stripe.paymentMethods.detach(paymentMethodId);
      logger.info({ paymentMethodId }, 'Payment method detached');
    } catch (error) {
      logger.error({ error, paymentMethodId }, 'Failed to detach payment method');
      throw new InternalError('Failed to remove payment method');
    }
  }
}
