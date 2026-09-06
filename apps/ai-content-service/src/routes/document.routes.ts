import {
  auditLog,
  remoteProfileContext,
  requireAuth,
  requireConsent,
  requireRole,
} from '@longeny/middleware';
import { ConsentType, UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { DocumentController } from '../controllers/document.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const REPORT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    document_type: {
      type: 'string',
      enum: ['lab_report', 'prescription', 'imaging', 'insurance', 'certificate', 'other'],
    },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    file_name: { type: 'string' },
    mime_type: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    ai_generated: { type: 'boolean' },
    status: { type: 'string', enum: ['processing', 'active', 'archived', 'deleted'] },
    reported_at: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When the report was produced. Null for rows uploaded before this was recorded.',
    },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export function createDocumentRoutes(controller: DocumentController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole(UserRole.PROVIDER);
  const consentRequired = requireConsent(ConsentType.DATA_SHARING_PROVIDERS);

  // Provider-only section
  const providerRoutes = new Elysia()
    .use(authRequired)
    .use(providerRequired)
    .get('/shared-with-me', controller.sharedWithMe)
    .get('/provider/:providerId/accessible', controller.getProviderAccessibleDocuments);

  // Auth-required general section
  const authRoutes = new Elysia()
    .use(authRequired)
    // Header-only, because a provider owns no profiles at all and still uploads
    // documents here. A patient upload with no header resolves its own profile
    // inside the handler instead, where the owner type is known. Reads below
    // stay account-scoped for now — converting them is the D2 query card.
    .use(
      remoteProfileContext({
        serviceName: 'ai-content-service',
        userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
        hmacSecret: config.HMAC_SECRET,
        mode: 'header-only',
      }),
    )
    .get('/tags', controller.tagCloud)
    .get('/timeline', controller.timeline)
    .post('/upload', controller.upload)
    .get('/', controller.listDocuments)
    .get('/:id', controller.getDocument)
    .put('/:id', controller.updateDocument)
    .get('/:id/download', controller.downloadDocument)
    .get('/:id/access-log', controller.getAccessLog)
    .delete('/:id', controller.deleteDocument)
    .delete('/:id/share/:grantId', controller.revokeAccess)
    .post('/:id/tags', controller.addTags)
    .delete('/:id/tags/:tag', controller.removeTag);

  // Consent-gated sharing
  const consentRoutes = new Elysia()
    .use(authRequired)
    .use(consentRequired)
    .post('/:id/share', controller.shareDocument);

  // ── Reports timeline, scoped to a profile ──
  //
  // Served under /profiles rather than /documents because that is the contract
  // the client sees; the gateway maps /api/v1/profiles/:id/reports here while
  // the rest of /api/v1/profiles goes to user-provider.
  const reportRoutes = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'reports.timeline',
        resourceType: 'document',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .get('/:profileId/reports', controller.reportsForProfile, {
      detail: {
        tags: ['documents'],
        summary: 'Report timeline for a profile',
        security: [{ BearerAuth: [] }],
        description:
          'Reports for one subject of care, newest report-date first — the order the tests happened, not the order they were uploaded.\n\nTwo ways to read it: the account owns the profile, or the caller is a provider with an active booking for it. A provider with no engagement gets 404, the same answer a stranger gets, because a 403 would confirm the profile exists.',
        responses: {
          200: okDoc('Reports, newest report-date first', {
            type: 'array',
            items: REPORT_SHAPE,
          }),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          404: errorDoc(
            'No such profile, not this account’s profile, or no active booking for this provider',
            'NOT_FOUND',
          ),
          503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
        },
      },
    });

  return new Elysia()
    .use(
      new Elysia({ prefix: '/documents' }).use(providerRoutes).use(authRoutes).use(consentRoutes),
    )
    .use(reportRoutes);
}
