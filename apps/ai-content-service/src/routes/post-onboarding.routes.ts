import { requireAuth } from '@longeny/middleware';
import { Elysia, t } from 'elysia';
import type { PostOnboardingController } from '../controllers/post-onboarding.controller.js';

export function createPostOnboardingRoutes(controller: PostOnboardingController) {
  return new Elysia({ prefix: '/ai/post-onboarding', detail: { tags: ['post-onboarding'] } })
    .use(requireAuth())
    .post(
      '/start',
      ({ body, store }) => controller.start({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          onboarding_session_id: t.String({
            minLength: 1,
            description: 'Completed onboarding session ID to pull context from',
          }),
        }),
        detail: {
          summary: 'Start post-onboarding session',
          description:
            'Creates a new post-onboarding session using context from a completed onboarding. Returns personalized health tips and consultation preparation guidance.',
        },
      },
    )
    .post('/step', ({ body }) => controller.step({ body }), {
      body: t.Object({
        session_id: t.String({ minLength: 1, description: 'Active post-onboarding session ID' }),
        answer: t.String({ minLength: 1, description: 'Patient follow-up question or message' }),
      }),
      detail: {
        summary: 'Submit follow-up and stream response (SSE)',
        description:
          'Submits a follow-up question and returns an SSE stream with health tips, consultation prep, and follow-up suggestions. Max 5 turns per session.',
      },
    });
}
