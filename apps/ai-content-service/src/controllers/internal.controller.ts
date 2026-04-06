import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import {
  recommendation_cache,
  ai_requests,
  generated_documents,
  safety_logs,
} from '../db/schema.js';
import type { EmbeddingService, EmbeddingEntityType } from '../services/embedding.service.js';
import type { DocumentService } from '../services/document.service.js';
import { BadRequestError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';

const logger = createLogger('ai-content:internal');

export class InternalController {
  constructor(
    _prismaUnused: unknown,
    private embeddingService: EmbeddingService,
    private documentService: DocumentService,
  ) {}

  /**
   * POST /internal/embeddings/generate
   * Generate embedding for an entity.
   */
  generateEmbedding = async ({ body, set }: any) => {
    if (!body.entityType) throw new BadRequestError('entityType is required');
    if (!body.entityId) throw new BadRequestError('entityId is required');
    if (!body.text) throw new BadRequestError('text is required');

    const validTypes: EmbeddingEntityType[] = ['provider', 'program', 'product', 'user_profile'];
    if (!validTypes.includes(body.entityType)) {
      throw new BadRequestError(`entityType must be one of: ${validTypes.join(', ')}`);
    }

    const result = await this.embeddingService.generateAndStore({
      entityType: body.entityType as EmbeddingEntityType,
      entityId: body.entityId,
      text: body.text,
      metadata: body.metadata || {},
    });

    set.status = 201;
    return {
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /internal/gdpr/user-data/:userId
   * Return all AI data + documents for DSAR export.
   */
  getUserData = async ({ params }: any) => {
    const { userId } = params;

    // Gather AI-related data
    const [
      recommendations,
      aiRequestsData,
      generatedDocs,
      safetyLogsData,
      documentData,
    ] = await Promise.all([
      db.select().from(recommendation_cache).where(eq(recommendation_cache.user_id, userId)),
      db
        .select({
          id: ai_requests.id,
          request_type: ai_requests.request_type,
          model: ai_requests.model,
          prompt_tokens: ai_requests.prompt_tokens,
          completion_tokens: ai_requests.completion_tokens,
          total_tokens: ai_requests.total_tokens,
          estimated_cost: ai_requests.estimated_cost,
          status: ai_requests.status,
          cache_hit: ai_requests.cache_hit,
          created_at: ai_requests.created_at,
        })
        .from(ai_requests)
        .where(eq(ai_requests.user_id, userId)),
      db
        .select({
          id: generated_documents.id,
          document_type: generated_documents.document_type,
          title: generated_documents.title,
          status: generated_documents.status,
          ai_model: generated_documents.ai_model,
          created_at: generated_documents.created_at,
          approved_at: generated_documents.approved_at,
        })
        .from(generated_documents)
        .where(eq(generated_documents.user_id, userId)),
      db
        .select({
          id: safety_logs.id,
          output_flagged: safety_logs.output_flagged,
          flag_category: safety_logs.flag_category,
          input_filtered: safety_logs.input_filtered,
          disclaimer_injected: safety_logs.disclaimer_injected,
          created_at: safety_logs.created_at,
        })
        .from(safety_logs)
        .where(eq(safety_logs.user_id, userId)),
      this.documentService.getUserDataForDsar(userId),
    ]);

    return {
      success: true,
      data: {
        ai: {
          recommendations,
          aiRequests: aiRequestsData,
          generatedDocuments: generatedDocs,
          safetyLogs: safetyLogsData,
        },
        documents: documentData,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * DELETE /internal/gdpr/user-data/:userId
   * Delete all AI embeddings, recommendations, documents, and S3 files.
   */
  deleteUserData = async ({ params }: any) => {
    const { userId } = params;

    logger.info({ userId }, 'GDPR erasure initiated');

    // 1. Delete embeddings
    const embeddingsDeleted = await this.embeddingService.deleteAllForUser(userId);

    // 2. Delete recommendation cache
    const recsResult = await db
      .delete(recommendation_cache)
      .where(eq(recommendation_cache.user_id, userId));
    const recsDeleted = (recsResult as any).rowCount ?? 0;

    // 3. Delete safety logs for user
    const safetyResult = await db
      .delete(safety_logs)
      .where(eq(safety_logs.user_id, userId));
    const safetyLogsDeleted = (safetyResult as any).rowCount ?? 0;

    // 4. Delete AI requests
    // First unlink generated documents
    await db
      .update(generated_documents)
      .set({ ai_request_id: null })
      .where(eq(generated_documents.user_id, userId));

    const aiRequestsResult = await db
      .delete(ai_requests)
      .where(eq(ai_requests.user_id, userId));
    const aiRequestsDeleted = (aiRequestsResult as any).rowCount ?? 0;

    // 5. Delete generated documents
    const genDocsResult = await db
      .delete(generated_documents)
      .where(eq(generated_documents.user_id, userId));
    const genDocsDeleted = (genDocsResult as any).rowCount ?? 0;

    // 6. Delete vault documents and S3 files
    const documentResult = await this.documentService.deleteAllForUser(userId);

    const summary = {
      embeddingsDeleted,
      recommendationsDeleted: recsDeleted,
      safetyLogsDeleted,
      aiRequestsDeleted,
      generatedDocumentsDeleted: genDocsDeleted,
      vaultDocumentsDeleted: documentResult.documentsDeleted,
      s3FilesDeleted: documentResult.s3FilesDeleted,
    };

    logger.info({ userId, ...summary }, 'GDPR erasure completed');

    return {
      success: true,
      data: summary,
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
