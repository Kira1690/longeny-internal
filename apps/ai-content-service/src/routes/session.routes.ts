import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { SessionController } from '../controllers/session.controller.js';

export function createSessionRoutes(controller: SessionController): Elysia {
  return new Elysia({ prefix: '/ai/sessions' })
    .use(requireAuth())
    .post('/start', ({ store }) => controller.start({ store: store as any }))
    .get('/history', ({ store }) => controller.history({ store: store as any }))
    .get('/:id', ({ params }) => controller.getSession({ params }));
}
