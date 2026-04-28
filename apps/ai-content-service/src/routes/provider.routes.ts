import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { ProviderController } from '../controllers/provider.controller.js';

export function createProviderRoutes(controller: ProviderController): Elysia {
  return new Elysia({ prefix: '/ai/provider' })
    .use(requireAuth())
    .post(
      '/profile',
      ({ body, store }) => controller.upsert({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          specialties: t.Array(t.String(), { minItems: 1 }),
          conditions_treated: t.Optional(t.Array(t.String())),
          consultation_modes: t.Array(t.String(), { minItems: 1 }),
          languages: t.Optional(t.Array(t.String())),
          city: t.Optional(t.String()),
          hourly_rate_inr: t.Optional(t.Number({ minimum: 0 })),
          years_experience: t.Optional(t.Number({ minimum: 0 })),
          availability_rules: t.Optional(t.Record(t.String(), t.Unknown())),
          bio: t.Optional(t.String()),
        }),
      },
    )
    .get('/profile/:id', ({ params }) => controller.get({ params }))
    .get(
      '/profiles',
      ({ query }) => controller.list({ query }),
      {
        query: t.Object({
          specialty: t.Optional(t.String()),
          city: t.Optional(t.String()),
          mode: t.Optional(t.String()),
        }),
      },
    )
    .put('/profile/:id/deactivate', ({ params }) => controller.deactivate({ params }));
}
