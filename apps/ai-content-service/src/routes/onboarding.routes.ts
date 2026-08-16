import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { OnboardingController } from '../controllers/onboarding.controller.js';

export function createOnboardingRoutes(controller: OnboardingController): Elysia {
  return new Elysia({ prefix: '/ai/onboarding', detail: { tags: ['onboarding'] } })
    .use(requireAuth())
    .post('/start', ({ store }) => controller.start({ store: store as { userId: string } }), {
      detail: {
        summary: 'Start onboarding session',
        description:
          'Creates a new Aria AI onboarding session and returns the first question. Aria greets the authenticated patient by their account name. Supports English and Hindi.',
      },
    })
    .post(
      '/step',
      ({ body }) => controller.step({ body }),
      {
        body: t.Object({
          session_id: t.String({ minLength: 1, description: 'Active onboarding session ID' }),
          answer: t.String({ minLength: 1, description: 'Patient answer text (English or Hindi)' }),
        }),
        detail: {
          summary: 'Submit answer and stream response (SSE)',
          description:
            'Saves the patient answer and returns an SSE stream with tool_call (extracted symptoms/conditions), token-by-token response, and message_done events.',
        },
      },
    )
    .get('/session/:id', ({ params }) => controller.getSession({ params }), {
      detail: {
        summary: 'Get onboarding session state',
        description: 'Returns current session state including turn number, symptoms collected, and completion status.',
      },
    });
}
