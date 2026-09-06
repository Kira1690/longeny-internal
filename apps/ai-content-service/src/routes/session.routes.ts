import { remoteProfileContext, requireAuth } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { SessionController } from '../controllers/session.controller.js';

export function createSessionRoutes(controller: SessionController) {
  return new Elysia({ prefix: '/ai/sessions', detail: { tags: ['sessions'] } })
    .use(requireAuth())
    .use(
      remoteProfileContext({
        serviceName: 'ai-content-service',
        userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
        hmacSecret: config.HMAC_SECRET,
      }),
    )
    .post('/start', ({ store }) => controller.start({ store }), {
      detail: {
        summary: 'Create new onboarding session',
        description:
          "Creates a new onboarding session linked to the authenticated user and returns the session ID with Aria's first question.",
      },
    })
    .get('/history', ({ store }) => controller.history({ store }), {
      detail: {
        summary: 'Get user session history',
        description:
          'Returns the onboarding sessions this account started, newest first, each with the profile it was about. Listed from this service’s ownership record rather than from the agent, which has no way to prove a user id belongs to the caller.',
      },
    })
    .get('/:id', ({ params, store }) => controller.getSession({ params, store }), {
      detail: {
        summary: 'Get session details',
        description:
          'Returns full details of a specific onboarding session including symptoms, conditions, preferences, and match payload. Another account’s session answers 404.',
      },
    });
}
