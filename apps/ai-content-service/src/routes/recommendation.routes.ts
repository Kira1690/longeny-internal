import { Elysia } from 'elysia';
import { requireAuth, requireConsent } from '@longeny/middleware';
import type { RecommendationController } from '../controllers/recommendation.controller.js';

export function createRecommendationRoutes(controller: RecommendationController): Elysia {
  const authRequired = requireAuth();
  const consentRequired = requireConsent('ai_profiling');

  return new Elysia({ prefix: '/ai/recommendations' })
    .use(authRequired)
    .use(consentRequired)
    .get('/', controller.getGeneralRecommendations)
    .get('/providers', controller.getProviderRecommendations)
    .get('/programs', controller.getProgramRecommendations)
    .get('/products', controller.getProductRecommendations)
    .post('/:id/feedback', controller.submitFeedback);
}
