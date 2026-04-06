import Stripe from 'stripe';
import { createLogger } from '@longeny/utils';
import { loadConfig, paymentConfigSchema } from '@longeny/config';
import { InternalError, BadRequestError } from '@longeny/errors';

const config = loadConfig(paymentConfigSchema);
const logger = createLogger('payment-service:stripe');

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!config.STRIPE_SECRET_KEY) {
      throw new InternalError('STRIPE_SECRET_KEY is not configured');
    }
    stripeInstance = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return stripeInstance;
}

export async function createCustomer(
  userId: string,
  email: string,
): Promise<Stripe.Customer> {
  const stripe = getStripe();
  try {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });
    logger.info({ userId, customerId: customer.id }, 'Stripe customer created');
    return customer;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to create Stripe customer');
    throw new InternalError('Failed to create payment customer');
  }
}

export async function createCheckoutSession(
  order: {
    id: string;
    order_number: string;
    total: number;
    currency: string;
    items: Array<{ description: string; quantity: number; unit_price: number }>;
  },
  customerId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  try {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => ({
      price_data: {
        currency: order.currency.toLowerCase(),
        product_data: { name: item.description },
        unit_amount: Math.round(item.unit_price * 100),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orderId: order.id,
        orderNumber: order.order_number,
      },
    });

    logger.info({ orderId: order.id, sessionId: session.id }, 'Checkout session created');
    return session;
  } catch (error) {
    logger.error({ error, orderId: order.id }, 'Failed to create checkout session');
    throw new InternalError('Failed to create checkout session');
  }
}

export async function createPaymentIntent(
  amount: number,
  currency: string,
  customerId: string,
  metadata: Record<string, string>,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata,
      automatic_payment_methods: { enabled: true },
    });
    logger.info({ paymentIntentId: paymentIntent.id }, 'Payment intent created');
    return paymentIntent;
  } catch (error) {
    logger.error({ error }, 'Failed to create payment intent');
    throw new InternalError('Failed to create payment intent');
  }
}

export async function createSubscription(
  customerId: string,
  priceId: string,
  trialDays?: number,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  try {
    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    };

    if (trialDays && trialDays > 0) {
      params.trial_period_days = trialDays;
    }

    const subscription = await stripe.subscriptions.create(params);
    logger.info({ subscriptionId: subscription.id, customerId }, 'Stripe subscription created');
    return subscription;
  } catch (error) {
    logger.error({ error, customerId, priceId }, 'Failed to create Stripe subscription');
    throw new InternalError('Failed to create subscription');
  }
}

export async function cancelSubscription(
  subscriptionId: string,
  immediately = false,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  try {
    if (immediately) {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      logger.info({ subscriptionId }, 'Stripe subscription cancelled immediately');
      return subscription;
    }

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    logger.info({ subscriptionId }, 'Stripe subscription set to cancel at period end');
    return subscription;
  } catch (error) {
    logger.error({ error, subscriptionId }, 'Failed to cancel Stripe subscription');
    throw new InternalError('Failed to cancel subscription');
  }
}

export async function createRefund(
  paymentIntentId: string,
  amount?: number,
): Promise<Stripe.Refund> {
  const stripe = getStripe();
  try {
    const params: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };
    if (amount !== undefined) {
      params.amount = Math.round(amount * 100);
    }

    const refund = await stripe.refunds.create(params);
    logger.info({ refundId: refund.id, paymentIntentId }, 'Stripe refund created');
    return refund;
  } catch (error) {
    logger.error({ error, paymentIntentId }, 'Failed to create Stripe refund');
    throw new InternalError('Failed to process refund');
  }
}

export function constructWebhookEvent(
  body: string,
  signature: string,
  secret: string,
): Stripe.Event {
  const stripe = getStripe();
  try {
    return stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    logger.error({ error }, 'Webhook signature verification failed');
    throw new BadRequestError('Invalid webhook signature');
  }
}

export async function listPaymentMethods(
  customerId: string,
): Promise<Stripe.PaymentMethod[]> {
  const stripe = getStripe();
  try {
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return methods.data;
  } catch (error) {
    logger.error({ error, customerId }, 'Failed to list payment methods');
    throw new InternalError('Failed to list payment methods');
  }
}

export async function createSetupIntent(
  customerId: string,
): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();
  try {
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
    logger.info({ setupIntentId: setupIntent.id, customerId }, 'Setup intent created');
    return setupIntent;
  } catch (error) {
    logger.error({ error, customerId }, 'Failed to create setup intent');
    throw new InternalError('Failed to create setup intent');
  }
}

export async function detachPaymentMethod(
  paymentMethodId: string,
): Promise<Stripe.PaymentMethod> {
  const stripe = getStripe();
  try {
    const method = await stripe.paymentMethods.detach(paymentMethodId);
    logger.info({ paymentMethodId }, 'Payment method detached');
    return method;
  } catch (error) {
    logger.error({ error, paymentMethodId }, 'Failed to detach payment method');
    throw new InternalError('Failed to remove payment method');
  }
}

export async function retrieveSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    logger.error({ error, subscriptionId }, 'Failed to retrieve subscription');
    throw new InternalError('Failed to retrieve subscription');
  }
}

export async function deleteCustomer(
  customerId: string,
): Promise<Stripe.DeletedCustomer> {
  const stripe = getStripe();
  try {
    const deleted = await stripe.customers.del(customerId);
    logger.info({ customerId }, 'Stripe customer deleted');
    return deleted;
  } catch (error) {
    logger.error({ error, customerId }, 'Failed to delete Stripe customer');
    throw new InternalError('Failed to delete customer');
  }
}
