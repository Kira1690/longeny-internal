import { remoteProfileContext, requireAuth } from '@longeny/middleware';
import { Elysia, t } from 'elysia';
import { config } from '../config/index.js';
import type { OnboardingController } from '../controllers/onboarding.controller.js';

export function createOnboardingRoutes(controller: OnboardingController) {
  return (
    new Elysia({ prefix: '/ai/onboarding', detail: { tags: ['onboarding'] } })
      .use(requireAuth())
      // The session is about a subject of care, not about an account: send
      // X-Active-Profile-Id to onboard a dependent profile.
      .use(
        remoteProfileContext({
          serviceName: 'ai-content-service',
          userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
          hmacSecret: config.HMAC_SECRET,
        }),
      )
      .post('/start', ({ store }) => controller.start({ store }), {
        detail: {
          summary: 'Start onboarding session for the active profile',
          description:
            'Creates a new Aria AI onboarding session and returns the first question, scoped to the profile this request is acting as (`X-Active-Profile-Id`, or the account owner’s own profile when omitted). Aria greets the authenticated patient by their account name. Supports English and Hindi. The answers persist to the profile the session was started for, not to the account owner.',
        },
      })
      .post('/step', ({ body, store }) => controller.step({ body, store }), {
        body: t.Object({
          session_id: t.String({ minLength: 1, description: 'Active onboarding session ID' }),
          answer: t.String({ minLength: 1, description: 'Patient answer text (English or Hindi)' }),
        }),
        detail: {
          summary: 'Submit answer and stream response (SSE)',
          description:
            'Saves the patient answer and returns an SSE stream with tool_call (extracted symptoms/conditions), token-by-token response, and message_done events.',
        },
      })
      .get('/session/:id', ({ params, store }) => controller.getSession({ params, store }), {
        detail: {
          summary: 'Get onboarding session state',
          description:
            'Returns current session state including turn number, symptoms collected, and completion status. A session belonging to another account answers 404 — a transcript carries symptoms and conditions, so the id alone is not authority to read it.',
        },
      })
  );
}
