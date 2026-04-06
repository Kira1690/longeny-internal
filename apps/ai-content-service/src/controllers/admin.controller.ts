import type { EmbeddingService } from '../services/embedding.service.js';
import type { AdminService } from '../services/admin.service.js';
import { parsePaginationParams, buildPaginationMeta } from '@longeny/utils';

export class AdminController {
  constructor(
    private embeddingService: EmbeddingService,
    private adminService: AdminService,
  ) {}

  /**
   * POST /ai/embeddings/generate
   * Trigger embedding generation for specified entities.
   */
  generateEmbeddings = async ({ body, set }: any) => {
    const result = await this.adminService.triggerEmbeddingGeneration({
      entityType: body.entityType,
      entityIds: body.entityIds,
      forceRegenerate: body.forceRegenerate ?? false,
    });

    set.status = 202;
    return {
      success: true,
      data: result,
      message: 'Embedding generation triggered',
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /ai/embeddings/status
   * Get embedding pipeline status.
   */
  getEmbeddingStatus = async (_ctx: any) => {
    const status = await this.adminService.getEmbeddingPipelineStatus();

    return {
      success: true,
      data: status,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /ai/usage
   * Get AI usage statistics.
   */
  getUsageStats = async ({ query }: any) => {
    const stats = await this.adminService.getUsageStats(query.startDate, query.endDate);

    return {
      success: true,
      data: stats,
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * GET /ai/prompts
   * List prompt templates.
   */
  listPromptTemplates = async ({ query }: any) => {
    const { page, limit } = parsePaginationParams(query);

    const { templates, total } = await this.adminService.listPromptTemplates({ page, limit });

    return {
      success: true,
      data: templates,
      pagination: buildPaginationMeta(total, page, limit),
      meta: { timestamp: new Date().toISOString() },
    };
  };

  /**
   * PUT /ai/prompts/:id
   * Update a prompt template.
   */
  updatePromptTemplate = async ({ params, body }: any) => {
    const template = await this.adminService.updatePromptTemplate(params.id, {
      name: body.name,
      systemPrompt: body.systemPrompt,
      userPromptTemplate: body.userPromptTemplate,
      modelId: body.modelId,
      maxTokens: body.maxTokens,
      temperature: body.temperature,
      isActive: body.isActive,
    });

    return {
      success: true,
      data: template,
      message: 'Prompt template updated',
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
