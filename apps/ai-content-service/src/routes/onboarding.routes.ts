import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { OnboardingController } from '../controllers/onboarding.controller.js';

export function createOnboardingRoutes(controller: OnboardingController): Elysia {
  return new Elysia({ prefix: '/ai/onboarding' })
    .use(requireAuth())
    .post('/start', () => controller.start())
    .post(
      '/step',
      ({ body }) => controller.step({ body }),
      {
        body: t.Object({
          session_id: t.String({ minLength: 1 }),
          answer: t.String({ minLength: 1 }),
        }),
      },
    )
    .get('/session/:id', ({ params }) => controller.getSession({ params }));
}
