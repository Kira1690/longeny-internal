import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { NotificationController } from '../controllers/notification.controller.js';

export function createNotificationRoutes(controller: NotificationController): Elysia {
  return new Elysia({ prefix: '/ai/notifications', detail: { tags: ['notifications'] } })
    .use(requireAuth())
    .get('/pending', ({ store }) =>
      controller.getPending({ store: store as { userId: string } }),
      {
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Array(t.Object({
              notification_id: t.String({ description: 'Unique notification UUID' }),
              provider_id: t.String(),
              patient_summary: t.String({ description: 'LLM-generated PHI-safe patient summary' }),
              specialties_needed: t.Array(t.String()),
              urgency_level: t.String({ description: '"routine", "soon", or "urgent"' }),
              consultation_mode: t.String({ description: '"online", "offline", or "either"' }),
              match_score: t.Number({ description: '0-100 matching score' }),
              created_at: t.String(),
              status: t.String({ description: '"pending"' }),
            })),
          }),
        },
        detail: {
          summary: 'Get pending notifications',
          description:
            'Returns all pending patient-match notifications for the authenticated provider. Each includes an LLM-generated PHI-safe summary (no patient name/contact). Provider ID taken from JWT.',
        },
      },
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
          ], { description: 'New status: "viewed", "accepted", or "declined"' }),
        }),
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Object({ updated: t.Boolean() }),
          }),
        },
        detail: {
          summary: 'Update notification status',
          description:
            'Updates notification status. Flow: pending -> viewed -> accepted/declined. When provider accepts, the patient can proceed to schedule an appointment.',
        },
      },
    );
}
