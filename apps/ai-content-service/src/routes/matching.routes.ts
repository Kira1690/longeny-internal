import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { MatchingController } from '../controllers/matching.controller.js';

export function createMatchingRoutes(controller: MatchingController): Elysia {
  return new Elysia({ prefix: '/ai/matching' })
    .use(requireAuth())
    .post(
      '/match',
      ({ body, store }) => controller.match({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          session_id: t.String({ minLength: 1 }),
        }),
      },
    )
    .get('/match/:matchId', ({ params }) => controller.getResult({ params }));
}
