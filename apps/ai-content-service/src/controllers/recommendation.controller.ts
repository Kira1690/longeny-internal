import type { RecommendationService, RecommendationType } from '../services/recommendation.service.js';
import { BadRequestError } from '@longeny/errors';

export class RecommendationController {
  constructor(private recommendationService: RecommendationService) {}

  /**
   * GET /ai/recommendations
   * General recommendations combining providers + programs.
   */
  getGeneralRecommendations = async ({ store, query }: any) => {
    const limit = Math.min(Number(query.limit) || 10, 50);

    // Fetch both provider and program recommendations in parallel
    const [providerResult, programResult] = await Promise.all([
      this.recommendationService.getRecommendations(
        store.userId,
        'providers' as RecommendationType,
        Math.ceil(limit / 2),
      ),
      this.recommendationService.getRecommendations(
        store.userId,
        'programs' as RecommendationType,
        Math.ceil(limit / 2),
      ),
    ]);

    // Merge and sort by score
    const combined = [
      ...providerResult.recommendations,
      ...programResult.recommendations,
    ].sort((a, b) => b.score - a.score).slice(0, limit);

    return {
      success: true,
      data: combined,
      meta: {
        timestamp: new Date().toISOString(),
        summary: `${providerResult.summary} ${programResult.summary}`,
        isMock: providerResult.isMock || programResult.isMock,
        cached: providerResult.cached && programResult.cached,
      },
    };
  };

  /**
   * GET /ai/recommendations/providers
   */
  getProviderRecommendations = async ({ store, query }: any) => {
    const limit = Math.min(Number(query.limit) || 10, 50);

    const result = await this.recommendationService.getRecommendations(
      store.userId,
      'providers' as RecommendationType,
      limit,
    );

    return {
      success: true,
      data: result.recommendations,
      meta: {
        timestamp: new Date().toISOString(),
        summary: result.summary,
        modelUsed: result.modelUsed,
        isMock: result.isMock,
        cached: result.cached,
        scoreBreakdown: result.scoreBreakdown,
      },
    };
  };

  /**
   * GET /ai/recommendations/programs
   */
  getProgramRecommendations = async ({ store, query }: any) => {
    const limit = Math.min(Number(query.limit) || 10, 50);

    const result = await this.recommendationService.getRecommendations(
      store.userId,
      'programs' as RecommendationType,
      limit,
    );

    return {
      success: true,
      data: result.recommendations,
      meta: {
        timestamp: new Date().toISOString(),
        summary: result.summary,
        modelUsed: result.modelUsed,
        isMock: result.isMock,
        cached: result.cached,
      },
    };
  };

  /**
   * GET /ai/recommendations/products
   */
  getProductRecommendations = async ({ store, query }: any) => {
    const limit = Math.min(Number(query.limit) || 10, 50);

    const result = await this.recommendationService.getRecommendations(
      store.userId,
      'products' as RecommendationType,
      limit,
    );

    return {
      success: true,
      data: result.recommendations,
      meta: {
        timestamp: new Date().toISOString(),
        summary: result.summary,
        modelUsed: result.modelUsed,
        isMock: result.isMock,
        cached: result.cached,
      },
    };
  };

  /**
   * POST /ai/recommendations/:id/feedback
   */
  submitFeedback = async ({ store, params, body }: any) => {
    if (!body.rating || typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5) {
      throw new BadRequestError('Rating must be a number between 1 and 5');
    }

    await this.recommendationService.submitFeedback(store.userId, params.id, {
      rating: body.rating,
      helpful: body.helpful ?? true,
      comment: body.comment,
    });

    return {
      success: true,
      data: { message: 'Feedback submitted successfully' },
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
