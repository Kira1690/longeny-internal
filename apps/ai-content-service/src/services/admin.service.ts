import { db } from '../db/index.js';
import { sql, eq, and, gte, lte } from 'drizzle-orm';
import { ai_requests, prompt_templates } from '../db/schema.js';
import type { EmbeddingService, EmbeddingEntityType } from './embedding.service.js';
import { NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:admin');

export class AdminService {
  constructor(
    _prismaUnused: unknown,
    private embeddingService: EmbeddingService,
  ) {}

  // ── Embedding Generation ──

  async triggerEmbeddingGeneration(input: {
    entityType: EmbeddingEntityType;
    entityIds?: string[];
    forceRegenerate: boolean;
  }): Promise<{ triggered: number; entityType: string }> {
    const { entityType, entityIds, forceRegenerate } = input;

    // If specific entity IDs provided, generate for those
    if (entityIds && entityIds.length > 0) {
      let triggered = 0;
      for (const entityId of entityIds) {
        try {
          await this.embeddingService.generateAndStore({
            entityType,
            entityId,
            text: `Entity ${entityType}:${entityId}`,
            metadata: { triggeredBy: 'admin', forceRegenerate },
          });
          triggered++;
        } catch (error) {
          logger.error({ entityType, entityId, error }, 'Failed to generate embedding for entity');
        }
      }
      logger.info({ entityType, triggered, total: entityIds.length }, 'Embedding generation triggered');
      return { triggered, entityType };
    }

    // Otherwise, check existing count for status
    const result = await db.execute<{ count: bigint }>(sql`
      SELECT COUNT(*) as count FROM "embeddings"
      WHERE entity_type = ${entityType}::"EmbeddingEntityType"
    `);

    const count = Number((result as any)[0]?.count || 0);
    logger.info({ entityType, existingCount: count, forceRegenerate }, 'Embedding generation status checked');

    return { triggered: 0, entityType };
  }

  // ── Embedding Pipeline Status ──

  async getEmbeddingPipelineStatus(): Promise<{
    totalEmbeddings: number;
    byEntityType: Record<string, number>;
    lastUpdated: string | null;
  }> {
    const counts = await db.execute<
      { entity_type: string; count: bigint; last_updated: Date | null }
    >(sql`
      SELECT entity_type, COUNT(*) as count, MAX(updated_at) as last_updated
      FROM "embeddings"
      GROUP BY entity_type
    `);

    const byEntityType: Record<string, number> = {};
    let totalEmbeddings = 0;
    let lastUpdated: string | null = null;

    for (const row of counts as any) {
      const count = Number(row.count);
      byEntityType[row.entity_type] = count;
      totalEmbeddings += count;
      if (row.last_updated) {
        const ts = new Date(row.last_updated).toISOString();
        if (!lastUpdated || ts > lastUpdated) {
          lastUpdated = ts;
        }
      }
    }

    return { totalEmbeddings, byEntityType, lastUpdated };
  }

  // ── AI Usage Statistics ──

  async getUsageStats(startDate?: string, endDate?: string): Promise<{
    totalCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
    byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number }>;
    byPurpose: Record<string, number>;
  }> {
    const conditions = [];
    if (startDate) conditions.push(gte(ai_requests.created_at, new Date(startDate)));
    if (endDate) conditions.push(lte(ai_requests.created_at, new Date(endDate)));

    const logs = await db
      .select({
        model_id: ai_requests.model,
        purpose: ai_requests.request_type,
        tokens_in: ai_requests.prompt_tokens,
        tokens_out: ai_requests.completion_tokens,
      })
      .from(ai_requests)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    let totalCalls = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number }> = {};
    const byPurpose: Record<string, number> = {};

    for (const log of logs) {
      totalCalls++;
      totalTokensIn += log.tokens_in;
      totalTokensOut += log.tokens_out;

      const modelKey = log.model_id;
      if (!byModel[modelKey]) {
        byModel[modelKey] = { calls: 0, tokensIn: 0, tokensOut: 0 };
      }
      byModel[modelKey]!.calls++;
      byModel[modelKey]!.tokensIn += log.tokens_in;
      byModel[modelKey]!.tokensOut += log.tokens_out;

      const purposeKey = log.purpose || 'unknown';
      byPurpose[purposeKey] = (byPurpose[purposeKey] || 0) + 1;
    }

    return { totalCalls, totalTokensIn, totalTokensOut, byModel, byPurpose };
  }

  // ── Prompt Templates ──

  async listPromptTemplates(options: { page: number; limit: number }) {
    const [templates, [{ count }]] = await Promise.all([
      db
        .select()
        .from(prompt_templates)
        .orderBy(sql`${prompt_templates.created_at} DESC`)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(prompt_templates),
    ]);

    return { templates, total: count };
  }

  async updatePromptTemplate(
    id: string,
    data: {
      name?: string;
      systemPrompt?: string;
      userPromptTemplate?: string;
      modelId?: string;
      maxTokens?: number;
      temperature?: number;
      isActive?: boolean;
    },
  ) {
    const [template] = await db
      .select()
      .from(prompt_templates)
      .where(eq(prompt_templates.id, id))
      .limit(1);

    if (!template) {
      throw new NotFoundError('PromptTemplate', id);
    }

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.systemPrompt !== undefined) updateData.system_prompt = data.systemPrompt;
    if (data.userPromptTemplate !== undefined) updateData.user_prompt_template = data.userPromptTemplate;
    if (data.maxTokens !== undefined) updateData.max_tokens = data.maxTokens;
    if (data.temperature !== undefined) updateData.temperature = data.temperature.toString();
    if (data.isActive !== undefined) updateData.status = data.isActive ? 'active' : 'deprecated';

    const [updated] = await db
      .update(prompt_templates)
      .set(updateData as any)
      .where(eq(prompt_templates.id, id))
      .returning();

    logger.info({ templateId: id }, 'Prompt template updated');
    return updated;
  }
}
