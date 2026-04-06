import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { bookings, processed_events } from '../db/schema.js';
import type { EventConsumer } from '@longeny/events';
import type { EventEnvelope } from '@longeny/types';
import { EVENT_NAMES } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import type { BookingService } from '../services/booking.service.js';
import type { NotificationService } from '../services/notification.service.js';

const logger = createLogger('booking-service:subscribers');

interface PaymentCompletedPayload {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  metadata?: {
    bookingId?: string;
  };
}

interface GdprErasurePayload {
  userId: string;
  requestId: string;
}

interface NotificationSendPayload {
  userId: string;
  type: 'email' | 'sms' | 'push' | 'in_app';
  category: 'booking' | 'payment' | 'system' | 'marketing' | 'reminder' | 'document' | 'provider' | 'progress';
  title: string;
  body: string;
  bodyHtml?: string;
  bookingId?: string;
  data?: Record<string, unknown>;
}

export function registerSubscribers(
  consumer: EventConsumer,
  _unused: unknown,
  bookingService: BookingService,
  notificationService: NotificationService,
): void {
  // ─── payment.completed → confirm booking ─────────────────────

  consumer.on<PaymentCompletedPayload>(
    EVENT_NAMES.PAYMENT_COMPLETED,
    async (event: EventEnvelope<PaymentCompletedPayload>) => {
      const { payload } = event;

      // Check for idempotency
      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) {
        logger.debug({ eventId: event.correlationId }, 'Event already processed, skipping');
        return;
      }

      const bookingId = payload.metadata?.bookingId;
      if (!bookingId) {
        logger.debug({ orderId: payload.orderId }, 'Payment completed but no booking ID in metadata');
        return;
      }

      try {
        const [booking] = await db
          .select()
          .from(bookings)
          .where(eq(bookings.id, bookingId))
          .limit(1);

        if (!booking) {
          logger.warn({ bookingId }, 'Booking not found for payment completion');
          return;
        }

        if (booking.status === 'pending') {
          await db
            .update(bookings)
            .set({ order_id: payload.orderId, status: 'confirmed' })
            .where(eq(bookings.id, bookingId));

          await notificationService.createInAppNotification({
            userId: booking.user_id,
            bookingId: booking.id,
            category: 'booking',
            title: 'Booking Confirmed',
            body: `Your booking has been confirmed after payment of ${payload.amount} ${payload.currency}.`,
          });

          logger.info({ bookingId, orderId: payload.orderId }, 'Booking confirmed via payment');
        }

        // Mark event as processed
        await db
          .insert(processed_events)
          .values({
            event_id: event.correlationId,
            event_type: EVENT_NAMES.PAYMENT_COMPLETED,
          });
      } catch (error) {
        logger.error({ bookingId, error }, 'Failed to process payment.completed event');
      }
    },
  );

  // ─── user.gdpr.erasure.requested → anonymize ────────────────

  consumer.on<GdprErasurePayload>(
    EVENT_NAMES.GDPR_ERASURE_REQUESTED,
    async (event: EventEnvelope<GdprErasurePayload>) => {
      const { payload } = event;

      // Idempotency check
      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) {
        logger.debug({ eventId: event.correlationId }, 'GDPR event already processed');
        return;
      }

      try {
        logger.info({ userId: payload.userId }, 'Processing GDPR erasure request');

        await bookingService.anonymizeUserBookings(payload.userId);
        await notificationService.deleteUserNotifications(payload.userId);

        await db
          .insert(processed_events)
          .values({
            event_id: event.correlationId,
            event_type: EVENT_NAMES.GDPR_ERASURE_REQUESTED,
          });

        logger.info({ userId: payload.userId }, 'GDPR erasure completed for booking service');
      } catch (error) {
        logger.error({ userId: payload.userId, error }, 'Failed to process GDPR erasure');
      }
    },
  );

  // ─── notification.send → process delivery ────────────────────

  consumer.on<NotificationSendPayload>(
    'notification.send',
    async (event: EventEnvelope<NotificationSendPayload>) => {
      const { payload } = event;

      try {
        await notificationService.sendNotification({
          userId: payload.userId,
          type: payload.type,
          category: payload.category,
          title: payload.title,
          body: payload.body,
          bodyHtml: payload.bodyHtml,
          bookingId: payload.bookingId,
          data: payload.data,
        });

        logger.debug(
          { userId: payload.userId, type: payload.type },
          'Notification processed from event',
        );
      } catch (error) {
        logger.error({ payload, error }, 'Failed to process notification.send event');
      }
    },
  );

  logger.info('Event subscribers registered');
}
