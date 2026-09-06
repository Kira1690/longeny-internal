import { requireAuth } from '@longeny/middleware';
import { Elysia, t } from 'elysia';
import type { MatchingController } from '../controllers/matching.controller.js';

export function createMatchingRoutes(controller: MatchingController) {
  return new Elysia({ prefix: '/ai/matching', detail: { tags: ['matching'] } })
    .use(requireAuth())
    .post(
      '/match',
      ({ body, store }) => controller.match({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          session_id: t.String({ minLength: 1, description: 'Completed onboarding session ID' }),
        }),
        detail: {
          summary: 'Run patient-provider matching',
          description:
            'Runs the 7-dimension weighted matching algorithm against the completed onboarding session. Scores providers on specialty (40), consultation mode (15), location (15), language (10), budget (10), rating (5), experience (5). Returns top 5 matches.',
        },
      },
    )
    .get('/match/:matchId', ({ params }) => controller.getResult({ params }), {
      detail: {
        summary: 'Get match result',
        description:
          'Returns a previously computed match result including provider scores and breakdown.',
      },
    });
}
