import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { PostOnboardingController } from '../controllers/post-onboarding.controller.js';

export function createPostOnboardingRoutes(controller: PostOnboardingController): Elysia {
  return new Elysia({ prefix: '/ai/post-onboarding' })
    .use(requireAuth())
    .post(
      '/start',
      ({ body, store }) =>
        controller.start({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          onboarding_session_id: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      '/step',
      ({ body }) => controller.step({ body }),
      {
        body: t.Object({
          session_id: t.String({ minLength: 1 }),
          answer: t.String({ minLength: 1 }),
        }),
      },
    );
}
