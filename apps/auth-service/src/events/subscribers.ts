import { EventConsumer } from '@longeny/events';
import { EVENT_NAMES, type EventEnvelope } from '@longeny/types';
import { createLogger } from '@longeny/utils';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, oauth_accounts, consents, user_roles, credentials, processed_events } from '../db/schema.js';
import { anonymizeAuditLogs } from '../services/audit.service.js';
import { redisUrl } from '../config/index.js';

const logger = createLogger('auth-service:subscribers');

let consumer: EventConsumer;

export function initSubscribers(_: unknown): EventConsumer {
  consumer = new EventConsumer(redisUrl, 'auth-service');

  // Handle GDPR erasure requests
  consumer.on<{ credentialId: string; userId: string }>(
    EVENT_NAMES.GDPR_ERASURE_REQUESTED,
    async (event: EventEnvelope<{ credentialId: string; userId: string }>) => {
      const { credentialId } = event.payload;

      logger.info({ credentialId, correlationId: event.correlationId }, 'Processing GDPR erasure request');

      // Check idempotency
      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) {
        logger.info({ correlationId: event.correlationId }, 'Event already processed, skipping');
        return;
      }

      try {
        // Delete sessions
        await db.delete(sessions).where(eq(sessions.credential_id, credentialId));

        // Delete OAuth accounts
        await db.delete(oauth_accounts).where(eq(oauth_accounts.credential_id, credentialId));

        // Delete consents
        await db.delete(consents).where(eq(consents.credential_id, credentialId));

        // Delete user roles
        await db.delete(user_roles).where(eq(user_roles.credential_id, credentialId));

        // Anonymize audit logs (preserve for compliance but remove PII)
        await anonymizeAuditLogs(credentialId);

        // Delete the credential itself
        await db.delete(credentials).where(eq(credentials.id, credentialId));

        // Mark event as processed
        await db.insert(processed_events).values({
          event_id: event.correlationId,
          event_type: EVENT_NAMES.GDPR_ERASURE_REQUESTED,
        });

        logger.info({ credentialId, correlationId: event.correlationId }, 'GDPR erasure completed');
      } catch (error) {
        logger.error({ credentialId, error, correlationId: event.correlationId }, 'GDPR erasure failed');
        throw error;
      }
    },
  );

  return consumer;
}

export async function startSubscribers(): Promise<void> {
  await consumer.start();
  logger.info('Event subscribers started');
}

export async function stopSubscribers(): Promise<void> {
  await consumer.stop();
}
