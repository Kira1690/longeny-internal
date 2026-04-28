import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { NotificationController } from '../controllers/notification.controller.js';

export function createNotificationRoutes(controller: NotificationController): Elysia {
  return new Elysia({ prefix: '/ai/notifications' })
    .use(requireAuth())
    .get('/pending', ({ store }) =>
      controller.getPending({ store: store as { userId: string } }),
    )
    .put(
      '/:id/status',
      ({ params, body, store }) =>
        controller.updateStatus({
          params,
          body,
          store: store as { userId: string },
        }),
      {
        body: t.Object({
          status: t.Union([
            t.Literal('viewed'),
            t.Literal('accepted'),
            t.Literal('declined'),
          ]),
        }),
      },
    );
}
