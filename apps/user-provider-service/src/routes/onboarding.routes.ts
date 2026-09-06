import { requireAuth, requireRole } from '@longeny/middleware';
import { Elysia, t } from 'elysia';
import type { OnboardingController } from '../controllers/onboarding.controller.js';

const bearer = { security: [{ BearerAuth: [] }] };

const sectionKeyParam = t.Object({
  section: t.String({
    description:
      'Section key: basic_identity, professional_credentials, license_verification, practice_services, scheduling_setup, marketplace_profile, banking_commercial, platform_readiness, document_capability, compliance_consents, legal_declarations, trust_layer',
  }),
});

const providerIdParam = t.Object({
  providerId: t.String({ description: 'Provider UUID' }),
});

export function createOnboardingRoutes(controller: OnboardingController) {
  const providerRoutes = new Elysia({
    prefix: '/providers/me/onboarding',
    detail: { tags: ['Provider Onboarding'] },
  })
    .use(requireAuth())
    .use(requireRole('provider' as any))
    .post('/init', controller.initOnboarding as any, {
      detail: {
        summary: 'Initialize onboarding',
        description:
          'Creates onboarding record for authenticated provider. Idempotent — returns existing if already created.',
        ...bearer,
      },
    })
    .get('/', controller.getOnboarding as any, {
      detail: {
        summary: 'Get full onboarding state',
        description: 'Returns complete onboarding record with all 12 section data and statuses.',
        ...bearer,
      },
    })
    .get('/progress', controller.getProgress as any, {
      detail: {
        summary: 'Get completion progress',
        description: 'Returns section-by-section status summary and overall completion count.',
        ...bearer,
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            status: t.String(),
            completed_sections: t.Number(),
            total_sections: t.Number(),
            sections: t.Record(
              t.String(),
              t.String({ description: 'not_started | in_progress | completed' }),
            ),
          }),
        }),
      },
    })
    .get('/sections/:section', controller.getSection as any, {
      params: sectionKeyParam,
      detail: {
        summary: 'Get single section data',
        description: 'Returns data and status for one specific section.',
        ...bearer,
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            section: t.String(),
            status: t.String(),
            data: t.Nullable(t.Unknown()),
          }),
        }),
      },
    })
    .put('/sections/:section', controller.saveSection as any, {
      params: sectionKeyParam,
      body: t.Object({
        data: t.Unknown({ description: 'Section-specific field data (see section schemas)' }),
        mark_complete: t.Optional(
          t.Boolean({ description: 'true = full validation, false = partial save (default)' }),
        ),
      }),
      detail: {
        summary: 'Save section data',
        description:
          'Saves section data with partial (draft) or full (complete) validation. Partial save sets status to in_progress, complete sets to completed. Consent/declaration sections get server-side timestamps.',
        ...bearer,
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            section: t.String(),
            status: t.String(),
            data: t.Unknown(),
          }),
        }),
      },
    })
    .post('/submit', controller.submitOnboarding as any, {
      detail: {
        summary: 'Submit onboarding for review',
        description:
          'Submits completed onboarding for admin review. All 12 sections must be completed. Status changes from draft to submitted.',
        ...bearer,
      },
    })
    .post('/upload-url', controller.getUploadUrl as any, {
      body: t.Object({
        field_name: t.String({
          description:
            'Document field: profile_photo_url | govt_id_proof_url | address_proof_url | insurance_proof_url',
        }),
        content_type: t.String({
          description: 'MIME type: image/jpeg | image/png | image/webp | application/pdf',
        }),
      }),
      detail: {
        summary: 'Get presigned S3 upload URL',
        description:
          'Returns a 15-minute presigned PUT URL for uploading an onboarding document directly to S3. After upload completes, save the returned public_url into the relevant section field.',
        ...bearer,
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            upload_url: t.String({ description: 'Presigned PUT URL (15 min expiry)' }),
            public_url: t.String({
              description: 'Public URL to store in section field after upload',
            }),
            key: t.String({ description: 'S3 object key' }),
            expires_in: t.Number({ description: 'Seconds until URL expires' }),
          }),
        }),
      },
    });

  const adminRoutes = new Elysia({
    prefix: '/admin/onboarding',
    detail: { tags: ['Admin Onboarding Review'] },
  })
    .use(requireAuth())
    .use(requireRole('admin' as any, 'super_admin' as any))
    .get('/', controller.adminListProviders as any, {
      detail: {
        summary: 'List all providers with onboarding status',
        description:
          'Returns paginated list of providers with their onboarding progress, status, and basic info. Filter by onboarding status (draft, submitted, under_review, approved, rejected).',
        ...bearer,
      },
    })
    .get('/:providerId', controller.adminGetOnboarding as any, {
      params: providerIdParam,
      detail: {
        summary: 'View provider onboarding (admin)',
        description: 'Returns full onboarding record for a specific provider.',
        ...bearer,
      },
    })
    .get('/:providerId/documents', controller.adminGetDocumentUrls as any, {
      params: providerIdParam,
      detail: {
        summary: 'Get presigned view URLs for all uploaded documents',
        description:
          'Returns presigned GET URLs (15 min) for every document the provider uploaded during onboarding. Admin can open these in a browser to view/download.',
        ...bearer,
      },
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Object({
            provider_id: t.String(),
            documents: t.Array(
              t.Object({
                field: t.String({ description: 'Document field name (e.g. govt_id_proof_url)' }),
                section: t.String({ description: 'Section the document belongs to' }),
                public_url: t.String({ description: 'Stored S3 URL' }),
                view_url: t.String({ description: 'Presigned GET URL — open in browser to view' }),
              }),
            ),
            expires_in: t.Number({ description: 'Seconds until view URLs expire' }),
          }),
        }),
      },
    })
    .get('/:providerId/checks', controller.adminGetChecks as any, {
      params: providerIdParam,
      detail: {
        summary: 'Get admin verification checks',
        description: 'Returns 10 admin verification checks. Auto-creates them on first access.',
        ...bearer,
      },
    })
    .put('/:providerId/checks', controller.adminUpdateCheck as any, {
      params: providerIdParam,
      body: t.Object({
        check_key: t.String({
          description:
            'One of: credential_verified, license_verified, identity_verified, banking_verified, profile_reviewed, fees_confirmed, availability_confirmed, documents_reviewed, compliance_confirmed, admin_activated',
        }),
        is_checked: t.Boolean(),
        notes: t.Optional(t.String({ description: 'Optional admin notes' })),
      }),
      detail: {
        summary: 'Update an admin check',
        description: 'Toggles one of the 10 admin verification checks.',
        ...bearer,
      },
    })
    .put('/:providerId/status', controller.adminUpdateStatus as any, {
      params: providerIdParam,
      body: t.Object({
        status: t.Union([t.Literal('approved'), t.Literal('rejected')], {
          description: 'approved or rejected',
        }),
        reviewer_notes: t.Optional(t.String({ description: 'Reason for decision' })),
      }),
      detail: {
        summary: 'Approve or reject onboarding (super_admin only)',
        description:
          'Sets onboarding to approved or rejected. Requires super_admin role. On approval, provider status becomes verified.',
        ...bearer,
      },
    });

  return new Elysia().use(providerRoutes).use(adminRoutes);
}
