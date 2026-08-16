import { Elysia, t } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import type { ProviderController } from '../controllers/provider.controller.js';

export function createProviderRoutes(controller: ProviderController): Elysia {
  return new Elysia({ prefix: '/ai/provider', detail: { tags: ['provider-profiles'] } })
    .use(requireAuth())
    .post(
      '/profile',
      ({ body, store }) => controller.upsert({ body, store: store as { userId: string } }),
      {
        body: t.Object({
          specialties: t.Array(t.String(), { minItems: 1, description: 'Medical specialties e.g. ["neurology", "cardiology"]' }),
          conditions_treated: t.Optional(t.Array(t.String(), { description: 'Conditions e.g. ["migraine", "hypertension"]' })),
          consultation_modes: t.Array(t.String(), { minItems: 1, description: '["online"], ["offline"], or ["online","offline"]' }),
          languages: t.Optional(t.Array(t.String(), { description: 'ISO 639-1 codes e.g. ["en", "hi"]' })),
          city: t.Optional(t.String({ description: 'Provider city e.g. "Mumbai"' })),
          hourly_rate_inr: t.Optional(t.Number({ minimum: 0, description: 'Consultation rate in INR' })),
          years_experience: t.Optional(t.Number({ minimum: 0, description: 'Years of practice' })),
          availability_rules: t.Optional(t.Record(t.String(), t.Unknown(), { description: 'Custom availability schedule' })),
          bio: t.Optional(t.String({ description: 'Short professional bio' })),
        }),
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Object({
              provider_id: t.String({ description: 'Unique provider identifier (from JWT sub)' }),
              specialties: t.Array(t.String()),
              conditions_treated: t.Array(t.String()),
              consultation_modes: t.Array(t.String()),
              languages: t.Array(t.String()),
              city: t.Nullable(t.String()),
              hourly_rate_inr: t.Nullable(t.Number()),
              years_experience: t.Nullable(t.Number()),
              availability_rules: t.Nullable(t.Unknown()),
              bio: t.Nullable(t.String()),
              rating: t.Number({ description: '0.0 to 5.0' }),
              total_consultations: t.Number(),
              is_active: t.Boolean(),
              created_at: t.String({ description: 'ISO 8601 timestamp' }),
              updated_at: t.String({ description: 'ISO 8601 timestamp' }),
            }),
          }),
        },
        detail: {
          summary: 'Create or update provider profile',
          description:
            'Upserts the provider AI-matching profile. The provider_id is taken from the authenticated JWT `sub` claim. Stored in Redis with 90-day TTL. Call this when a provider first registers or updates their practice details.',
        },
      },
    )
    .get('/profile/:id', ({ params }) => controller.get({ params }), {
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            provider_id: t.String(),
            specialties: t.Array(t.String()),
            conditions_treated: t.Array(t.String()),
            consultation_modes: t.Array(t.String()),
            languages: t.Array(t.String()),
            city: t.Nullable(t.String()),
            hourly_rate_inr: t.Nullable(t.Number()),
            years_experience: t.Nullable(t.Number()),
            availability_rules: t.Nullable(t.Unknown()),
            bio: t.Nullable(t.String()),
            rating: t.Number(),
            total_consultations: t.Number(),
            is_active: t.Boolean(),
            created_at: t.String(),
            updated_at: t.String(),
          }),
        }),
      },
      detail: {
        summary: 'Get provider profile by ID',
        description: 'Returns the full AI profile for a specific provider. Used by patients to view provider details before booking.',
      },
    })
    .get(
      '/profiles',
      ({ query }) => controller.list({ query }),
      {
        query: t.Object({
          specialty: t.Optional(t.String({ description: 'Filter by specialty e.g. "neurology"' })),
          city: t.Optional(t.String({ description: 'Filter by city e.g. "Mumbai"' })),
          mode: t.Optional(t.String({ description: 'Filter by mode: "online" or "offline"' })),
        }),
        response: {
          200: t.Object({
            success: t.Boolean(),
            data: t.Array(t.Object({
              provider_id: t.String(),
              specialties: t.Array(t.String()),
              conditions_treated: t.Array(t.String()),
              consultation_modes: t.Array(t.String()),
              languages: t.Array(t.String()),
              city: t.Nullable(t.String()),
              hourly_rate_inr: t.Nullable(t.Number()),
              years_experience: t.Nullable(t.Number()),
              rating: t.Number(),
              is_active: t.Boolean(),
            })),
          }),
        },
        detail: {
          summary: 'List providers with filters',
          description:
            'Returns all active provider profiles. Supports filtering by specialty, city, and consultation mode. Used by matching algorithm and patient search.',
        },
      },
    )
    .put('/profile/:id/deactivate', ({ params }) => controller.deactivate({ params }), {
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({ deactivated: t.Boolean() }),
        }),
      },
      detail: {
        summary: 'Deactivate provider profile',
        description: 'Marks provider as inactive. Deactivated providers are excluded from matching and search results. Admin-only operation.',
      },
    });
}
