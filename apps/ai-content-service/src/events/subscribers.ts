import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { processed_events, recommendation_cache } from '../db/schema.js';
import { EventConsumer } from '@longeny/events';
import { EVENT_NAMES, type EventEnvelope } from '@longeny/types';
import { redisUrl } from '../config/index.js';
import { createLogger } from '@longeny/utils';
import { BedrockService } from '../services/bedrock.service.js';
import { EmbeddingService } from '../services/embedding.service.js';
import { DocumentService } from '../services/document.service.js';
import { S3Service } from '../services/s3.service.js';

const logger = createLogger('ai-content:subscriber');

let consumer: EventConsumer | null = null;

interface ProviderVerifiedPayload {
  providerId: string;
  name: string;
  specialties: string[];
  bio: string;
  location?: string;
}

interface ProgramCreatedPayload {
  programId: string;
  providerId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
}

interface GdprErasurePayload {
  userId: string;
  requestId: string;
  requestedAt: string;
}

export function startSubscribers(): EventConsumer {
  consumer = new EventConsumer(redisUrl, 'ai-content-service');

  const bedrockService = new BedrockService(null);
  const embeddingService = new EmbeddingService(null, bedrockService);
  const s3Service = new S3Service();
  const documentService = new DocumentService(null, s3Service);

  // ── provider.verified → embed provider ──
  consumer.on<ProviderVerifiedPayload>(
    EVENT_NAMES.PROVIDER_VERIFIED,
    async (event: EventEnvelope<ProviderVerifiedPayload>) => {
      const { providerId, name, specialties, bio, location } = event.payload;

      // Check idempotency
      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) {
        logger.debug({ eventId: event.correlationId }, 'Event already processed, skipping');
        return;
      }

      const text = [
        `Provider: ${name}`,
        `Specialties: ${specialties.join(', ')}`,
        bio,
        location ? `Location: ${location}` : '',
      ]
        .filter(Boolean)
        .join('. ');

      try {
        await embeddingService.generateAndStore({
          entityType: 'provider',
          entityId: providerId,
          text,
          metadata: { name, specialties, location },
        });

        await db.insert(processed_events).values({
          event_id: event.correlationId,
          event_type: EVENT_NAMES.PROVIDER_VERIFIED,
        });

        logger.info({ providerId }, 'Provider embedding created from event');
      } catch (error) {
        logger.error({ providerId, error }, 'Failed to embed provider from event');
      }
    },
  );

  // ── provider.program.created → embed program ──
  consumer.on<ProgramCreatedPayload>(
    EVENT_NAMES.PROVIDER_PROGRAM_CREATED,
    async (event: EventEnvelope<ProgramCreatedPayload>) => {
      const { programId, providerId, title, description, category, tags } = event.payload;

      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) return;

      const text = [
        `Program: ${title}`,
        `Category: ${category}`,
        description,
        tags.length ? `Tags: ${tags.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. ');

      try {
        await embeddingService.generateAndStore({
          entityType: 'program',
          entityId: programId,
          text,
          metadata: { title, category, tags, providerId },
        });

        await db.insert(processed_events).values({
          event_id: event.correlationId,
          event_type: EVENT_NAMES.PROVIDER_PROGRAM_CREATED,
        });

        logger.info({ programId, providerId }, 'Program embedding created from event');
      } catch (error) {
        logger.error({ programId, error }, 'Failed to embed program from event');
      }
    },
  );

  // ── user.gdpr.erasure.requested → delete all user data ──
  consumer.on<GdprErasurePayload>(
    EVENT_NAMES.GDPR_ERASURE_REQUESTED,
    async (event: EventEnvelope<GdprErasurePayload>) => {
      const { userId, requestId } = event.payload;

      const [existing] = await db
        .select()
        .from(processed_events)
        .where(eq(processed_events.event_id, event.correlationId))
        .limit(1);

      if (existing) return;

      try {
        logger.info({ userId, requestId }, 'Processing GDPR erasure from event');

        // Delete embeddings
        await embeddingService.deleteAllForUser(userId);

        // Delete recommendation cache
        await db.delete(recommendation_cache).where(eq(recommendation_cache.user_id, userId));

        // Delete vault documents and S3 files
        await documentService.deleteAllForUser(userId);

        await db.insert(processed_events).values({
          event_id: event.correlationId,
          event_type: EVENT_NAMES.GDPR_ERASURE_REQUESTED,
        });

        logger.info({ userId, requestId }, 'GDPR erasure completed from event');
      } catch (error) {
        logger.error({ userId, requestId, error }, 'GDPR erasure failed from event');
      }
    },
  );

  consumer.start().catch((error) => {
    logger.error({ error }, 'Failed to start event consumer');
  });

  return consumer;
}

export async function stopSubscribers(): Promise<void> {
  if (consumer) {
    await consumer.stop();
    consumer = null;
  }
}
