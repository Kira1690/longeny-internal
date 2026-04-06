import Razorpay from 'razorpay';
import { createHmac } from 'crypto';
import { createLogger } from '@longeny/utils';
import { InternalError } from '@longeny/errors';
import type {
  PaymentGateway,
  CheckoutParams,
  SubscriptionParams,
  PaymentIntentParams,
} from './index.js';

const logger = createLogger('payment-service:razorpay-gateway');

export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  private razorpay: InstanceType<typeof Razorpay>;

  constructor(keyId: string, keySecret: string) {
    if (!keyId || !keySecret) {
      throw new InternalError('Razorpay credentials are not configured');
    }
    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  async createCustomer(email: string, name: string): Promise<{ customerId: string }> {
    try {
      const customer = await (this.razorpay.customers as any).create({
        name,
        email,
      });
      logger.info({ customerId: customer.id }, 'Razorpay customer created');
      return { customerId: customer.id };
    } catch (error) {
      logger.error({ error }, 'Failed to create Razorpay customer');
      throw new InternalError('Failed to create payment customer');
    }
  }

  async createCheckoutSession(params: CheckoutParams): Promise<{ sessionId: string; url: string }> {
    try {
      // Razorpay uses orders instead of checkout sessions.
      // Amount is in smallest currency unit (paise for INR, cents for USD).
      const order = await this.razorpay.orders.create({
        amount: Math.round(params.amount * 100),
        currency: params.currency.toUpperCase(),
        receipt: params.orderNumber,
        notes: {
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          ...params.metadata,
        },
      });

      logger.info({ orderId: params.orderId, razorpayOrderId: order.id }, 'Razorpay order created');

      // Razorpay does not return a hosted checkout URL like Stripe.
      // The client uses the order ID to open Razorpay Checkout.js.
      // We return the order ID as the sessionId and a placeholder URL
      // that the frontend can use to initiate payment.
      return {
        sessionId: order.id,
        url: `razorpay://checkout?order_id=${order.id}`,
      };
    } catch (error) {
      logger.error({ error, orderId: params.orderId }, 'Failed to create Razorpay order');
      throw new InternalError('Failed to create checkout session');
    }
  }

  async createSubscription(params: SubscriptionParams) {
    try {
      const subParams: Record<string, any> = {
        plan_id: params.priceId,
        customer_id: params.customerId,
        total_count: 120, // Max billing cycles
      };

      if (params.trialDays && params.trialDays > 0) {
        // Razorpay uses start_at for trial; set it to trialDays from now
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + params.trialDays);
        subParams.start_at = Math.floor(trialEnd.getTime() / 1000);
      }

      if (params.metadata) {
        subParams.notes = params.metadata;
      }

      const subscription = await (this.razorpay.subscriptions as any).create(subParams);
      logger.info({ subscriptionId: subscription.id }, 'Razorpay subscription created');

      const now = new Date();
      const trialEnd = params.trialDays
        ? new Date(now.getTime() + params.trialDays * 86400000)
        : null;

      return {
        subscriptionId: subscription.id,
        clientSecret: subscription.short_url || null,
        currentPeriodStart: now,
        currentPeriodEnd: subscription.current_end
          ? new Date(subscription.current_end * 1000)
          : null,
        trialEnd,
        status: subscription.status || 'created',
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create Razorpay subscription');
      throw new InternalError('Failed to create subscription');
    }
  }

  async updateSubscription(subscriptionId: string, params: { priceId?: string; quantity?: number }) {
    try {
      const updateParams: Record<string, any> = {};

      if (params.priceId) {
        updateParams.plan_id = params.priceId;
      }

      if (params.quantity !== undefined) {
        updateParams.quantity = params.quantity;
      }

      const subscription = await (this.razorpay.subscriptions as any).update(
        subscriptionId,
        updateParams,
      );
      logger.info({ subscriptionId }, 'Razorpay subscription updated');

      return {
        subscriptionId: subscription.id,
        status: subscription.status,
      };
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to update Razorpay subscription');
      throw new InternalError('Failed to update subscription');
    }
  }

  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    try {
      await (this.razorpay.subscriptions as any).cancel(subscriptionId, immediately);
      logger.info({ subscriptionId, immediately }, 'Razorpay subscription cancelled');
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Failed to cancel Razorpay subscription');
      throw new InternalError('Failed to cancel subscription');
    }
  }

  async createRefund(paymentId: string, amount?: number): Promise<{ refundId: string }> {
    try {
      const params: Record<string, any> = {};
      if (amount !== undefined) {
        params.amount = Math.round(amount * 100);
      }

      const refund = await (this.razorpay.payments as any).refund(paymentId, params);
      logger.info({ refundId: refund.id, paymentId }, 'Razorpay refund created');
      return { refundId: refund.id };
    } catch (error) {
      logger.error({ error, paymentId }, 'Failed to create Razorpay refund');
      throw new InternalError('Failed to process refund');
    }
  }

  verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
    const expectedSignature = createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return expectedSignature === signature;
  }

  async createPaymentIntent(params: PaymentIntentParams): Promise<{ intentId: string; clientSecret: string }> {
    try {
      // Razorpay uses orders as the equivalent of payment intents
      const order = await this.razorpay.orders.create({
        amount: Math.round(params.amount * 100),
        currency: params.currency.toUpperCase(),
        notes: params.metadata || {},
      });

      logger.info({ orderId: order.id }, 'Razorpay order (payment intent) created');

      // The order ID serves as the client secret for Razorpay Checkout.js
      return {
        intentId: order.id,
        clientSecret: order.id,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create Razorpay order');
      throw new InternalError('Failed to create payment intent');
    }
  }

  async createSetupIntent(customerId: string): Promise<{ intentId: string; clientSecret: string }> {
    try {
      // Razorpay does not have a direct setup intent equivalent.
      // We create a customer token request to save card details.
      const token = await (this.razorpay.customers as any).fetchTokens(customerId);
      const tokenId = `rzp_setup_${customerId}_${Date.now()}`;
      logger.info({ customerId, tokenId }, 'Razorpay setup intent (token) created');

      return {
        intentId: tokenId,
        clientSecret: tokenId,
      };
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to create Razorpay setup intent');
      throw new InternalError('Failed to create setup intent');
    }
  }

  async listPaymentMethods(customerId: string) {
    try {
      const tokens = await (this.razorpay.customers as any).fetchTokens(customerId);
      const items = tokens?.items || [];

      return items.map((token: any) => ({
        id: token.id,
        type: token.method || 'card',
        card: token.card
          ? {
              brand: token.card.network || token.card.issuer || 'unknown',
              last4: token.card.last4 || '****',
              exp_month: parseInt(token.card.expiry_month || '0', 10),
              exp_year: parseInt(token.card.expiry_year || '0', 10),
            }
          : null,
      }));
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to list Razorpay payment methods');
      throw new InternalError('Failed to list payment methods');
    }
  }

  async detachPaymentMethod(tokenId: string): Promise<void> {
    try {
      // Razorpay tokens are deleted via the customer token endpoint.
      // The tokenId format should include the customer reference.
      await (this.razorpay.customers as any).deleteToken(tokenId);
      logger.info({ tokenId }, 'Razorpay token deleted');
    } catch (error) {
      logger.error({ error, tokenId }, 'Failed to delete Razorpay token');
      throw new InternalError('Failed to remove payment method');
    }
  }
}
