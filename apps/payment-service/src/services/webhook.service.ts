import { db } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import { gateway_webhook_events, orders, payments, refunds, subscriptions } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import { BadRequestError } from '@longeny/errors';
import { getStripeGateway, getRazorpayGateway } from './gateway/factory.js';
import * as paymentService from './payment.service.js';
import * as subscriptionService from './subscription.service.js';
import * as refundService from './refund.service.js';
import * as invoiceService from './invoice.service.js';
import { loadConfig, paymentConfigSchema } from '@longeny/config';

const logger = createLogger('payment-service:webhook');
const config = loadConfig(paymentConfigSchema);

// ── Stripe Webhook Processing ─────────────────────────────────

export async function processStripeWebhook(rawBody: string, signature: string) {
  const stripeGateway = getStripeGateway();
  const event = stripeGateway.constructWebhookEvent(
    rawBody,
    signature,
    config.STRIPE_WEBHOOK_SECRET,
  );

  await processWebhookIdempotent(event.id, 'stripe', event.type, event.data.object);
}

// ── Razorpay Webhook Processing ───────────────────────────────

export async function processRazorpayWebhook(rawBody: string, signature: string) {
  const razorpayGateway = getRazorpayGateway();

  const isValid = razorpayGateway.verifyWebhookSignature(
    rawBody,
    signature,
    config.RAZORPAY_WEBHOOK_SECRET,
  );

  if (!isValid) {
    throw new BadRequestError('Invalid Razorpay webhook signature');
  }

  const payload = JSON.parse(rawBody);
  const eventType = payload.event;
  const eventId = payload.payload?.payment?.entity?.id
    || payload.payload?.subscription?.entity?.id
    || payload.payload?.refund?.entity?.id
    || `rzp_${Date.now()}`;

  await processWebhookIdempotent(eventId, 'razorpay', eventType, payload);
}

// ── Idempotent Processing ─────────────────────────────────────

async function processWebhookIdempotent(
  eventId: string,
  gateway: 'stripe' | 'razorpay',
  eventType: string,
  payload: any,
) {
  const [existing] = await db
    .select()
    .from(gateway_webhook_events)
    .where(eq(gateway_webhook_events.gateway_event_id, eventId))
    .limit(1);

  if (existing?.processed) {
    logger.info({ eventId, eventType }, 'Webhook event already processed, skipping');
    return;
  }

  if (!existing) {
    await db.insert(gateway_webhook_events).values({
      gateway_event_id: eventId,
      payment_gateway: gateway,
      event_type: eventType,
      payload: payload,
      processed: false,
    });
  }

  try {
    if (gateway === 'stripe') {
      await handleStripeEvent(eventType, payload);
    } else {
      await handleRazorpayEvent(eventType, payload);
    }

    await db.update(gateway_webhook_events).set({
      processed: true,
      processed_at: new Date(),
    }).where(eq(gateway_webhook_events.gateway_event_id, eventId));

    logger.info({ eventId, eventType, gateway }, 'Webhook event processed successfully');
  } catch (error) {
    logger.error({ error, eventId, eventType, gateway }, 'Webhook event processing failed');
    throw error;
  }
}

// ── Stripe Event Handlers ─────────────────────────────────────

async function handleStripeEvent(eventType: string, data: any) {
  switch (eventType) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(data);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(data);
      break;
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(data);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(data);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(data);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(data);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(data);
      break;
    default:
      logger.debug({ eventType }, 'Unhandled Stripe webhook event type');
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: any) {
  const orderId = paymentIntent.metadata?.orderId;
  if (!orderId) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.gateway_payment_intent_id, paymentIntent.id))
      .limit(1);
    if (order) {
      await paymentService.handlePaymentSuccess(
        order.id,
        paymentIntent.id,
        paymentIntent.latest_charge,
        paymentIntent.charges?.data?.[0]?.receipt_url,
        paymentIntent.charges?.data?.[0]?.payment_method_details?.card?.last4,
        paymentIntent.charges?.data?.[0]?.payment_method_details?.card?.brand,
      );
      await invoiceService.createInvoiceForOrder(order.id);
    }
    return;
  }

  await paymentService.handlePaymentSuccess(
    orderId,
    paymentIntent.id,
    paymentIntent.latest_charge,
    paymentIntent.charges?.data?.[0]?.receipt_url,
    paymentIntent.charges?.data?.[0]?.payment_method_details?.card?.last4,
    paymentIntent.charges?.data?.[0]?.payment_method_details?.card?.brand,
  );
  await invoiceService.createInvoiceForOrder(orderId);
}

async function handlePaymentIntentFailed(paymentIntent: any) {
  const orderId = paymentIntent.metadata?.orderId;
  if (!orderId) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.gateway_payment_intent_id, paymentIntent.id))
      .limit(1);
    if (order) {
      await paymentService.handlePaymentFailure(
        order.id,
        paymentIntent.last_payment_error?.code,
        paymentIntent.last_payment_error?.message,
      );
    }
    return;
  }

  await paymentService.handlePaymentFailure(
    orderId,
    paymentIntent.last_payment_error?.code,
    paymentIntent.last_payment_error?.message,
  );
}

async function handleCheckoutSessionCompleted(session: any) {
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    logger.warn({ sessionId: session.id }, 'Checkout session has no orderId in metadata');
    return;
  }

  if (session.payment_status === 'paid') {
    const paymentIntentId = session.payment_intent;

    await db.update(orders).set({
      gateway_payment_intent_id: paymentIntentId,
      updated_at: new Date(),
    }).where(eq(orders.id, orderId));

    await paymentService.handlePaymentSuccess(orderId, paymentIntentId);
    await invoiceService.createInvoiceForOrder(orderId);
  }
}

async function handleInvoicePaymentSucceeded(invoice: any) {
  const gatewaySubscriptionId = invoice.subscription;
  if (!gatewaySubscriptionId) return;

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.gateway_subscription_id, gatewaySubscriptionId))
    .limit(1);

  if (subscription) {
    await subscriptionService.syncSubscriptionStatus(
      gatewaySubscriptionId,
      'active',
      invoice.period_start,
      invoice.period_end,
    );
    logger.info({ subscriptionId: subscription.id }, 'Subscription renewed via invoice payment');
  }
}

async function handleSubscriptionUpdated(stripeSubscription: any) {
  await subscriptionService.syncSubscriptionStatus(
    stripeSubscription.id,
    stripeSubscription.status,
    stripeSubscription.current_period_start,
    stripeSubscription.current_period_end,
    stripeSubscription.cancel_at_period_end,
  );
}

async function handleSubscriptionDeleted(stripeSubscription: any) {
  await subscriptionService.handleSubscriptionDeleted(stripeSubscription.id);
}

async function handleChargeRefunded(charge: any) {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.gateway_payment_id, paymentIntentId))
    .limit(1);

  if (payment) {
    const pendingRefunds = await db
      .select()
      .from(refunds)
      .where(and(
        eq(refunds.payment_id, payment.id),
        inArray(refunds.status, ['processing', 'approved']),
      ));

    for (const refund of pendingRefunds) {
      if (refund.gateway_refund_id) {
        await refundService.updateRefundStatus(refund.gateway_refund_id, 'approved', 'system');
      }
    }
  }

  logger.info({ chargeId: charge.id, paymentIntentId }, 'Charge refund processed');
}

// ── Razorpay Event Handlers ───────────────────────────────────

async function handleRazorpayEvent(eventType: string, payload: any) {
  switch (eventType) {
    case 'payment.captured':
      await handleRazorpayPaymentCaptured(payload);
      break;
    case 'payment.failed':
      await handleRazorpayPaymentFailed(payload);
      break;
    case 'order.paid':
      await handleRazorpayOrderPaid(payload);
      break;
    case 'subscription.activated':
    case 'subscription.charged':
      await handleRazorpaySubscriptionActivated(payload);
      break;
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
      await handleRazorpaySubscriptionEnded(payload);
      break;
    case 'subscription.halted':
    case 'subscription.pending':
      await handleRazorpaySubscriptionUpdated(payload);
      break;
    case 'refund.processed':
      await handleRazorpayRefundProcessed(payload);
      break;
    default:
      logger.debug({ eventType }, 'Unhandled Razorpay webhook event type');
  }
}

async function handleRazorpayPaymentCaptured(payload: any) {
  const payment = payload.payload?.payment?.entity;
  if (!payment) return;

  const orderId = payment.notes?.orderId;
  const razorpayOrderId = payment.order_id;

  let order;
  if (orderId) {
    const [found] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    order = found;
  }
  if (!order && razorpayOrderId) {
    const [found] = await db
      .select()
      .from(orders)
      .where(eq(orders.gateway_checkout_session_id, razorpayOrderId))
      .limit(1);
    order = found;
  }

  if (order) {
    await paymentService.handlePaymentSuccess(
      order.id,
      payment.id,
      undefined,
      undefined,
      payment.card?.last4,
      payment.card?.network,
    );
    await invoiceService.createInvoiceForOrder(order.id);
  } else {
    logger.warn({ razorpayPaymentId: payment.id }, 'No matching order found for Razorpay payment');
  }
}

async function handleRazorpayPaymentFailed(payload: any) {
  const payment = payload.payload?.payment?.entity;
  if (!payment) return;

  const orderId = payment.notes?.orderId;
  const razorpayOrderId = payment.order_id;

  let order;
  if (orderId) {
    const [found] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    order = found;
  }
  if (!order && razorpayOrderId) {
    const [found] = await db
      .select()
      .from(orders)
      .where(eq(orders.gateway_checkout_session_id, razorpayOrderId))
      .limit(1);
    order = found;
  }

  if (order) {
    await paymentService.handlePaymentFailure(
      order.id,
      payment.error_code,
      payment.error_description,
    );
  }
}

async function handleRazorpayOrderPaid(payload: any) {
  const orderEntity = payload.payload?.order?.entity;
  const paymentEntity = payload.payload?.payment?.entity;
  if (!orderEntity) return;

  const orderId = orderEntity.notes?.orderId;

  let order;
  if (orderId) {
    const [found] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    order = found;
  }
  if (!order) {
    const [found] = await db
      .select()
      .from(orders)
      .where(eq(orders.gateway_checkout_session_id, orderEntity.id))
      .limit(1);
    order = found;
  }

  if (order) {
    const paymentId = paymentEntity?.id || orderEntity.id;
    await paymentService.handlePaymentSuccess(
      order.id,
      paymentId,
      undefined,
      undefined,
      paymentEntity?.card?.last4,
      paymentEntity?.card?.network,
    );
    await invoiceService.createInvoiceForOrder(order.id);
  }
}

async function handleRazorpaySubscriptionActivated(payload: any) {
  const subscription = payload.payload?.subscription?.entity;
  if (!subscription) return;

  await subscriptionService.syncSubscriptionStatus(
    subscription.id,
    subscription.status,
    subscription.current_start,
    subscription.current_end,
  );

  logger.info({ razorpaySubscriptionId: subscription.id }, 'Razorpay subscription activated/charged');
}

async function handleRazorpaySubscriptionEnded(payload: any) {
  const subscription = payload.payload?.subscription?.entity;
  if (!subscription) return;

  await subscriptionService.handleSubscriptionDeleted(subscription.id);
  logger.info({ razorpaySubscriptionId: subscription.id }, 'Razorpay subscription ended');
}

async function handleRazorpaySubscriptionUpdated(payload: any) {
  const subscription = payload.payload?.subscription?.entity;
  if (!subscription) return;

  await subscriptionService.syncSubscriptionStatus(
    subscription.id,
    subscription.status,
    subscription.current_start,
    subscription.current_end,
  );

  logger.info({ razorpaySubscriptionId: subscription.id }, 'Razorpay subscription updated');
}

async function handleRazorpayRefundProcessed(payload: any) {
  const refund = payload.payload?.refund?.entity;
  if (!refund) return;

  const paymentId = refund.payment_id;
  if (!paymentId) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.gateway_payment_id, paymentId))
    .limit(1);

  if (payment) {
    const pendingRefunds = await db
      .select()
      .from(refunds)
      .where(and(
        eq(refunds.payment_id, payment.id),
        inArray(refunds.status, ['processing', 'approved']),
      ));

    for (const dbRefund of pendingRefunds) {
      await refundService.updateRefundStatus(dbRefund.gateway_refund_id || refund.id, 'approved', 'system');
    }
  }

  logger.info({ razorpayRefundId: refund.id, paymentId }, 'Razorpay refund processed');
}
