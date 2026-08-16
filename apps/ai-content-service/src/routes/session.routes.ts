import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { SessionController } from '../controllers/session.controller.js';

export function createSessionRoutes(controller: SessionController): Elysia {
  return new Elysia({ prefix: '/ai/sessions', detail: { tags: ['sessions'] } })
    .use(requireAuth())
    .post('/start', ({ store }) => controller.start({ store: store as any }), {
      detail: {
        summary: 'Create new onboarding session',
        description:
          'Creates a new onboarding session linked to the authenticated user and returns the session ID with Aria\'s first question.',
      },
    })
    .get('/history', ({ store }) => controller.history({ store: store as any }), {
      detail: {
        summary: 'Get user session history',
        description:
          'Returns all onboarding sessions for the authenticated user, ordered by most recent. Includes session status, turn count, and completion state.',
      },
    })
    .get('/:id', ({ params }) => controller.getSession({ params }), {
      detail: {
        summary: 'Get session details',
        description:
          'Returns full details of a specific onboarding session including symptoms, conditions, preferences, and match payload.',
      },
    });
}
