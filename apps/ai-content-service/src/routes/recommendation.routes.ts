import { requireAuth, requireConsent } from '@longeny/middleware';
import { ConsentType } from '@longeny/types';
import { Elysia } from 'elysia';
import type { RecommendationController } from '../controllers/recommendation.controller.js';

export function createRecommendationRoutes(controller: RecommendationController) {
  const authRequired = requireAuth();
  const consentRequired = requireConsent(ConsentType.AI_PROFILING);

  return new Elysia({ prefix: '/ai/recommendations' })
    .use(authRequired)
    .use(consentRequired)
    .get('/', controller.getGeneralRecommendations)
    .get('/providers', controller.getProviderRecommendations)
    .get('/programs', controller.getProgramRecommendations)
    .get('/products', controller.getProductRecommendations)
    .post('/:id/feedback', controller.submitFeedback);
}
