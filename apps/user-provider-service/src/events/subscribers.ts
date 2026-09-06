import type { EventConsumer } from '@longeny/events';
import { EVENT_NAMES, type EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { health_profiles, processed_events, reviews, users } from '../db/schema.js';
import type { ProfileService } from '../services/profile.service.js';
import type { UserService } from '../services/user.service.js';

const logger = createLogger('user-provider-subscriber');

/**
 * An event carries no request context, so there is no active profile header to
 * read. Every onboarding event we consume today is about the account owner, so
 * the subject of care is their `self` profile — resolved (and created on first
 * call) through the same guard the HTTP path uses.
 *
 * Week 7: ai-content starts sending `profileId` on the onboarding events once a
 * parent can run an intake for a dependent. Prefer that id over this fallback
 * as soon as it is on the envelope.
 */
export function registerSubscribers(
  consumer: EventConsumer,
  profileService: ProfileService,
  userService: UserService,
): void {
  // ── user.registered: Create default profile for new users ──
  consumer.on(EVENT_NAMES.USER_REGISTERED, async (event: EventEnvelope) => {
    const {
      credentialId: authId,
      email,
      firstName,
      lastName,
    } = event.payload as {
      credentialId: string;
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

      // Seeding the intake needs the self profile, which only exists once
      // ProfileService is asked for it — hence after the account row lands.
      const profileId = await profileService.getSelfProfileId(authId);
      await userService.initOnboardingState(authId, profileId);

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.USER_REGISTERED,
      });

      logger.info({ authId }, 'User profile defaults created');
    } catch (error) {
      logger.error(
        { error, authId, correlationId: event.correlationId },
        'Failed to handle user.registered',
      );
    }
  });

  // ── consent.revoked: Handle consent revocation ──
  consumer.on(EVENT_NAMES.CONSENT_REVOKED, async (event: EventEnvelope) => {
    const { authId, consentType } = event.payload as {
      authId: string;
      consentType: string;
    };

    logger.info(
      { authId, consentType, correlationId: event.correlationId },
      'Handling consent.revoked',
    );

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
          .set({
            consent_health_sharing: false,
            consent_ai_analysis: false,
            updated_at: new Date(),
          })
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
      logger.error(
        { error, authId, correlationId: event.correlationId },
        'Failed to handle consent.revoked',
      );
    }
  });

  // ── booking.completed: Check review eligibility ──
  consumer.on(EVENT_NAMES.BOOKING_COMPLETED, async (event: EventEnvelope) => {
    const { bookingId, userId, providerId } = event.payload as {
      bookingId: string;
      userId: string;
      providerId: string;
    };

    logger.info(
      { bookingId, userId, correlationId: event.correlationId },
      'Handling booking.completed',
    );

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
        logger.info(
          { userId, providerId, bookingId },
          'User eligible to review provider after booking completion',
        );
      }

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.BOOKING_COMPLETED,
      });
    } catch (error) {
      logger.error(
        { error, bookingId, correlationId: event.correlationId },
        'Failed to handle booking.completed',
      );
    }
  });

  // ── patient.onboarding.completed: persist AI onboarding intake to the durable profile ──
  consumer.on(EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED, async (event: EventEnvelope) => {
    const { authId, sessionId, profileId, finalPayload } = event.payload as {
      authId: string;
      sessionId: string;
      profileId?: string;
      finalPayload: Record<string, unknown>;
    };

    logger.info(
      { authId, sessionId, correlationId: event.correlationId },
      'Handling patient.onboarding.completed',
    );

    if (!authId || !finalPayload) {
      logger.warn(
        { authId, correlationId: event.correlationId },
        'Missing authId or finalPayload, skipping',
      );
      return;
    }

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
      // The session says which profile it was about. It is still checked against
      // this account before anything is written: the event travels over the
      // shared bus, and a payload is not proof of ownership. An unowned or
      // absent profile falls back to the account owner's own, which is what
      // every event published before profiles existed meant.
      let targetProfileId: string;
      if (profileId) {
        try {
          const { profile } = await profileService.assertOwnership(authId, profileId);
          targetProfileId = profile.id;
        } catch {
          logger.warn(
            { authId, sessionId, profileId },
            'Onboarding event named a profile this account does not own — using the self profile',
          );
          targetProfileId = await profileService.getSelfProfileId(authId);
        }
      } else {
        targetProfileId = await profileService.getSelfProfileId(authId);
      }

      await userService.applyOnboardingPayload(authId, targetProfileId, finalPayload);

      await db.insert(processed_events).values({
        event_id: event.correlationId,
        event_type: EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED,
      });

      logger.info(
        { authId, sessionId, profileId: targetProfileId },
        'AI onboarding intake persisted to durable profile',
      );
    } catch (error) {
      logger.error(
        { error, authId, sessionId, correlationId: event.correlationId },
        'Failed to handle patient.onboarding.completed',
      );
    }
  });

  logger.info('Event subscribers registered');
}
