import { db } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';
import { embeddings } from '../db/schema.js';
import type { BedrockService } from './bedrock.service.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:embedding');

export type EmbeddingEntityType = 'provider' | 'program' | 'product' | 'user_profile';

export interface EmbeddingInput {
  entityType: EmbeddingEntityType;
  entityId: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface SimilarityResult {
  id: string;
  entity_type: EmbeddingEntityType;
  entity_id: string;
  metadata: unknown;
  similarity: number;
}

export class EmbeddingService {
  constructor(
    _prismaUnused: unknown,
    private bedrockService: BedrockService,
  ) {}

  /**
   * Generate embedding for an entity and upsert to DB.
   */
  async generateAndStore(input: EmbeddingInput, userId?: string): Promise<{ id: string; isMock: boolean }> {
    const { entityType, entityId, text, metadata } = input;

    const result = await this.bedrockService.generateEmbedding(text, userId);
    const vectorStr = `[${result.embedding.join(',')}]`;

    // Upsert using raw SQL for pgvector support
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO "embeddings" (id, entity_type, entity_id, embedding, metadata, model_version, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${entityType}::"EmbeddingEntityType",
        ${entityId}::uuid,
        ${vectorStr}::vector,
        ${JSON.stringify(metadata)}::jsonb,
        'amazon.titan-embed-text-v2',
        NOW(),
        NOW()
      )
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET
        embedding = ${vectorStr}::vector,
        metadata = ${JSON.stringify(metadata)}::jsonb,
        updated_at = NOW()
      RETURNING id
    `);

    const id = (rows as any)[0]?.id || '';

    logger.info(
      { entityType, entityId, embeddingId: id, isMock: result.isMock },
      'Embedding stored',
    );

    return { id, isMock: result.isMock };
  }

  /**
   * Bulk embed multiple entities.
   */
  async bulkEmbed(inputs: EmbeddingInput[], userId?: string): Promise<Array<{ entityId: string; id: string; isMock: boolean }>> {
    const results: Array<{ entityId: string; id: string; isMock: boolean }> = [];

    for (const input of inputs) {
      try {
        const result = await this.generateAndStore(input, userId);
        results.push({ entityId: input.entityId, ...result });
      } catch (error) {
        logger.error({ entityId: input.entityId, error }, 'Failed to embed entity');
        results.push({ entityId: input.entityId, id: '', isMock: true });
      }
    }

    return results;
  }

  /**
   * pgvector similarity search.
   */
  async similaritySearch(
    queryVector: number[],
    entityType: EmbeddingEntityType,
    limit: number = 10,
  ): Promise<SimilarityResult[]> {
    const vectorStr = `[${queryVector.join(',')}]`;

    const results = await db.execute<SimilarityResult>(sql`
      SELECT id, entity_type, entity_id, metadata,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM "embeddings"
      WHERE entity_type = ${entityType}::"EmbeddingEntityType"
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return results as unknown as SimilarityResult[];
  }

  /**
   * Delete embeddings for an entity.
   */
  async deleteByEntity(entityType: EmbeddingEntityType, entityId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM "embeddings"
      WHERE entity_type = ${entityType}::"EmbeddingEntityType"
        AND entity_id = ${entityId}::uuid
    `);

    logger.info({ entityType, entityId }, 'Embedding deleted');
  }

  /**
   * Delete all embeddings for a user (GDPR erasure).
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM "embeddings"
      WHERE entity_type = 'user_profile'::"EmbeddingEntityType"
        AND entity_id = ${userId}::uuid
    `);

    const deleted = (result as any).rowCount ?? 0;
    logger.info({ userId, deleted }, 'User embeddings deleted (GDPR)');
    return deleted;
  }
}
