import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { SchedulingController } from '../controllers/scheduling.controller.js';

export function createSchedulingRoutes(controller: SchedulingController): Elysia {
  return new Elysia({ prefix: '/ai/scheduling' })
    .use(requireAuth())
    .post(
      '/check',
      ({ body }) => controller.checkAvailability({ body }),
      {
        body: t.Object({
          provider_id: t.String({ minLength: 1 }),
          date: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
          consultation_mode: t.Union([
            t.Literal('online'),
            t.Literal('offline'),
          ]),
        }),
      },
    )
    .post(
      '/book',
      ({ body, store }) =>
        controller.book({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          provider_id: t.String({ minLength: 1 }),
          slot_start: t.String({ minLength: 1 }),
          slot_end: t.String({ minLength: 1 }),
          consultation_mode: t.Union([
            t.Literal('online'),
            t.Literal('offline'),
          ]),
          session_id: t.Optional(t.String()),
          reason: t.Optional(t.String()),
        }),
      },
    )
    .get('/:id', ({ params }) => controller.getBooking({ params }));
}
