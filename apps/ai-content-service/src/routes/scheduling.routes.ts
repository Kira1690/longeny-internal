import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { SchedulingController } from '../controllers/scheduling.controller.js';

export function createSchedulingRoutes(controller: SchedulingController): Elysia {
  return new Elysia({ prefix: '/ai/scheduling', detail: { tags: ['scheduling'] } })
    .use(requireAuth())
    .post(
      '/check',
      ({ body }) => controller.checkAvailability({ body }),
      {
        body: t.Object({
          provider_id: t.String({ minLength: 1, description: 'Provider ID to check' }),
          date: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date as YYYY-MM-DD e.g. "2026-05-05"' }),
          consultation_mode: t.Union([
            t.Literal('online'),
            t.Literal('offline'),
          ], { description: '"online" or "offline"' }),
        }),
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Object({
              provider_id: t.String(),
              date: t.String(),
              slots: t.Array(t.Object({
                start: t.String({ description: 'Slot start ISO 8601' }),
                end: t.String({ description: 'Slot end ISO 8601' }),
                available: t.Boolean({ description: 'false if already booked' }),
              })),
            }),
          }),
        },
        detail: {
          summary: 'Check provider availability',
          description:
            'Returns 30-minute slots for a provider on a given date (default 09:00-17:00 = 16 slots). Booked slots show available: false.',
        },
      },
    )
    .post(
      '/book',
      ({ body, store }) =>
        controller.book({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          provider_id: t.String({ minLength: 1, description: 'Provider to book with' }),
          slot_start: t.String({ minLength: 1, description: 'ISO 8601 e.g. "2026-05-05T14:00:00"' }),
          slot_end: t.String({ minLength: 1, description: 'ISO 8601 e.g. "2026-05-05T14:30:00"' }),
          consultation_mode: t.Union([
            t.Literal('online'),
            t.Literal('offline'),
          ], { description: '"online" or "offline"' }),
          session_id: t.Optional(t.String({ description: 'Onboarding session ID for context' })),
          reason: t.Optional(t.String({ description: 'Reason for consultation' })),
        }),
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Object({
              booking_id: t.String({ description: 'Unique booking UUID' }),
              status: t.String({ description: '"confirmed" or "pending_provider"' }),
              provider_id: t.String(),
              patient_id: t.String(),
              slot_start: t.String(),
              slot_end: t.String(),
              consultation_mode: t.String(),
              created_at: t.String(),
            }),
          }),
        },
        detail: {
          summary: 'Book appointment slot',
          description:
            'Books a 30-min slot with a provider. Redis slot lock prevents double-booking. Returns booking_id with confirmed status. Patient ID taken from JWT.',
        },
      },
    )
    .get('/:id', ({ params }) => controller.getBooking({ params }), {
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            booking_id: t.String(),
            status: t.String(),
            provider_id: t.String(),
            patient_id: t.String(),
            slot_start: t.String(),
            slot_end: t.String(),
            consultation_mode: t.String(),
            created_at: t.String(),
          }),
        }),
      },
      detail: {
        summary: 'Get booking by ID',
        description: 'Returns full booking details including status, provider, time slot, and consultation mode.',
      },
    });
}
