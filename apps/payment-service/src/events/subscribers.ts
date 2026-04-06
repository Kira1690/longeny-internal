import { EventConsumer } from '@longeny/events';
import { EVENT_NAMES, type EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import { loadConfig, paymentConfigSchema } from '@longeny/config';
import { eq, and, lt, inArray, not } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  orders,
  order_items,
  payments,
  refunds,
  gateway_customers,
  subscriptions,
  processed_events,
} from '../db/schema.js';

const config = loadConfig(paymentConfigSchema);
const logger = createLogger('payment-service:subscriber');

const redisUrl = config.REDIS_PASSWORD
  ? `redis://:${config.REDIS_PASSWORD}@${config.REDIS_HOST}:${config.REDIS_PORT}`
  : `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;

const consumer = new EventConsumer(redisUrl, 'payment-service');

interface BookingCreatedPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  sessionType: string;
  sessionId?: string;
  programId?: string;
  amount: number;
  currency?: string;
}

interface BookingCancelledPayload {
  bookingId: string;
  userId: string;
  providerId: string;
  cancelledBy: string;
  reason?: string;
}

interface GdprErasurePayload {
  userId: string;
  requestId: string;
}

function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `ORD-${date}-${random}`;
}

/**
 * Handle booking.created: Create a pending order for the booking.
 */
async function handleBookingCreated(event: EventEnvelope<BookingCreatedPayload>) {
  const { bookingId, userId, providerId, sessionType, sessionId, programId, amount, currency } =
    event.payload;

  logger.info({ bookingId, userId }, 'Handling booking.created event');

  // Check if order already exists for this booking
  const [existing] = await db
    .select()
    .from(orders)
    .where(eq(orders.booking_id, bookingId))
    .limit(1);

  if (existing) {
    logger.info({ bookingId, orderId: existing.id }, 'Order already exists for booking');
    return;
  }

  const entityType = programId ? 'program' : 'session';
  const entityId = programId || sessionId || bookingId;

  const [order] = await db.insert(orders).values({
    order_number: generateOrderNumber(),
    user_id: userId,
    provider_id: providerId,
    booking_id: bookingId,
    order_type: programId ? 'program' : 'session',
    status: 'pending',
    subtotal: amount.toString(),
    tax: '0',
    platform_fee: parseFloat((amount * 0.1).toFixed(2)).toString(),
    platform_fee_percent: '10',
    discount: '0',
    total: amount.toString(),
    currency: currency || 'USD',
  }).returning();

  await db.insert(order_items).values({
    order_id: order.id,
    entity_type: entityType as 'session' | 'program' | 'product',
    entity_id: entityId,
    description: `${sessionType || 'Session'} booking`,
    quantity: 1,
    unit_price: amount.toString(),
    total_price: amount.toString(),
  });

  logger.info({ bookingId, userId, orderId: order.id }, 'Pending order created for booking');
}

/**
 * Handle booking.cancelled: Initiate refund if payment was made.
 */
async function handleBookingCancelled(event: EventEnvelope<BookingCancelledPayload>) {
  const { bookingId, userId, reason } = event.payload;

  logger.info({ bookingId, userId }, 'Handling booking.cancelled event');

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.booking_id, bookingId))
    .limit(1);

  if (!order) {
    logger.info({ bookingId }, 'No order found for cancelled booking');
    return;
  }

  if (order.status === 'paid' || order.status === 'fulfilled') {
    const [successfulPayment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.order_id, order.id), eq(payments.status, 'succeeded')))
      .limit(1);

    if (successfulPayment) {
      await db.insert(refunds).values({
        order_id: order.id,
        payment_id: successfulPayment.id,
        amount: successfulPayment.amount,
        reason: reason || 'Booking cancelled',
        status: 'pending',
        requested_by: userId,
      });
      logger.info({ bookingId, orderId: order.id }, 'Refund initiated for cancelled booking');
    }
  } else if (order.status === 'pending') {
    await db.update(orders).set({ status: 'cancelled', cancelled_at: new Date() }).where(eq(orders.id, order.id));
    logger.info({ bookingId, orderId: order.id }, 'Pending order cancelled');
  }
}

/**
 * Handle user.gdpr.erasure.requested: Anonymize payment data with 7-year retention.
 */
async function handleGdprErasure(event: EventEnvelope<GdprErasurePayload>) {
  const { userId, requestId } = event.payload;

  // Idempotency check
  const [existing] = await db
    .select()
    .from(processed_events)
    .where(eq(processed_events.event_id, event.correlationId))
    .limit(1);

  if (existing) {
    logger.debug({ eventId: event.correlationId }, 'GDPR event already processed, skipping');
    return;
  }

  logger.info({ userId, requestId }, 'Handling GDPR erasure request');

  try {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

    // Anonymize orders older than 7 years - remove PII notes/metadata
    await db.update(orders).set({
      notes: null,
      metadata: null,
      updated_at: new Date(),
    }).where(and(eq(orders.user_id, userId), lt(orders.created_at, sevenYearsAgo)));

    // Delete gateway customer record (removes Stripe link)
    await db.delete(gateway_customers).where(eq(gateway_customers.user_id, userId));

    // Mark subscriptions as cancelled
    await db.update(subscriptions).set({
      status: 'cancelled',
      cancelled_at: new Date(),
      cancellation_reason: 'GDPR erasure',
      updated_at: new Date(),
    }).where(and(
      eq(subscriptions.user_id, userId),
      not(eq(subscriptions.status, 'cancelled')),
    ));

    // Mark event as processed
    await db.insert(processed_events).values({
      event_id: event.correlationId,
      event_type: EVENT_NAMES.GDPR_ERASURE_REQUESTED,
    });

    logger.info({ userId }, 'GDPR erasure completed for payment data');
  } catch (error) {
    logger.error({ userId, requestId, error }, 'Failed to process GDPR erasure');
    throw error;
  }
}

export function registerSubscribers() {
  consumer.on<BookingCreatedPayload>(EVENT_NAMES.BOOKING_CREATED, handleBookingCreated);
  consumer.on<BookingCancelledPayload>(EVENT_NAMES.BOOKING_CANCELLED, handleBookingCancelled);
  consumer.on<GdprErasurePayload>(EVENT_NAMES.GDPR_ERASURE_REQUESTED, handleGdprErasure);

  logger.info('Event subscribers registered');
}

export async function startConsumer() {
  registerSubscribers();
  await consumer.start();
  logger.info('Event consumer started');
}

export async function stopConsumer() {
  await consumer.stop();
}
