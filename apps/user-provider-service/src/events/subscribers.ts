import { EventConsumer } from '@longeny/events';
import { EVENT_NAMES, type EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import { db } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { processed_events, health_profiles, reviews, users } from '../db/schema.js';
import { UserService } from '../services/user.service.js';

const logger = createLogger('user-provider-subscriber');

export function registerSubscribers(
  consumer: EventConsumer,
  _unused: unknown,
  userService: UserService,
): void {
  // ── user.registered: Create default profile for new users ──
  consumer.on(EVENT_NAMES.USER_REGISTERED, async (event: EventEnvelope) => {
    const { authId, email, firstName, lastName } = event.payload as {
      authId: string;
      email: string;
      firstName: string;
      lastName: string;
    };

    logger.info({ authId, correlationId: event.correlationId }, 'Handling user.registered');

    const [existing] = await db
      .select()
      .from(processed_events)
      .where(eq(processed_events.event_id, event.correlationId))
      .limit(1);

    if (existing) {
      logger.debug({ correlationId: event.correlationId }, 'Event already processed, skipping');
      return;
    }

    try {
      await userService.createProfileDefaults(authId, email, firstName, lastName);

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.USER_REGISTERED,
      });

      logger.info({ authId }, 'User profile defaults created');
    } catch (error) {
      logger.error({ error, authId, correlationId: event.correlationId }, 'Failed to handle user.registered');
    }
  });

  // ── consent.revoked: Handle consent revocation ──
  consumer.on(EVENT_NAMES.CONSENT_REVOKED, async (event: EventEnvelope) => {
    const { authId, consentType } = event.payload as {
      authId: string;
      consentType: string;
    };

    logger.info({ authId, consentType, correlationId: event.correlationId }, 'Handling consent.revoked');

    const [existing] = await db
      .select()
      .from(processed_events)
      .where(eq(processed_events.event_id, event.correlationId))
      .limit(1);

    if (existing) return;

    try {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.auth_id, authId))
        .limit(1);

      if (!user) {
        logger.warn({ authId }, 'User not found for consent revocation');
        return;
      }

      if (consentType === 'health_data_processing') {
        await db
          .update(health_profiles)
          .set({ consent_health_sharing: false, consent_ai_analysis: false, updated_at: new Date() })
          .where(eq(health_profiles.user_id, user.id));
        logger.info({ authId }, 'Health data consent flags cleared');
      }

      if (consentType === 'ai_profiling') {
        await db
          .update(health_profiles)
          .set({ consent_ai_analysis: false, updated_at: new Date() })
          .where(eq(health_profiles.user_id, user.id));
        logger.info({ authId }, 'AI analysis consent flag cleared');
      }

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.CONSENT_REVOKED,
      });
    } catch (error) {
      logger.error({ error, authId, correlationId: event.correlationId }, 'Failed to handle consent.revoked');
    }
  });

  // ── booking.completed: Check review eligibility ──
  consumer.on(EVENT_NAMES.BOOKING_COMPLETED, async (event: EventEnvelope) => {
    const { bookingId, userId, providerId } = event.payload as {
      bookingId: string;
      userId: string;
      providerId: string;
    };

    logger.info({ bookingId, userId, correlationId: event.correlationId }, 'Handling booking.completed');

    const [existing] = await db
      .select()
      .from(processed_events)
      .where(eq(processed_events.event_id, event.correlationId))
      .limit(1);

    if (existing) return;

    try {
      const [existingReview] = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.user_id, userId),
            sql`${reviews.target_type}::text = 'PROVIDER'`,
            eq(reviews.target_id, providerId),
          ),
        )
        .limit(1);

      if (!existingReview) {
        logger.info({ userId, providerId, bookingId }, 'User eligible to review provider after booking completion');
      }

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.BOOKING_COMPLETED,
      });
    } catch (error) {
      logger.error({ error, bookingId, correlationId: event.correlationId }, 'Failed to handle booking.completed');
    }
  });

  logger.info('Event subscribers registered');
}
