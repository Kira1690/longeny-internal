import {
  auditLog,
  remoteProfileContext,
  requireAuth,
  requireConsent,
  requireRole,
} from '@longeny/middleware';
import { ConsentType, UserRole } from '@longeny/types';
import { uploadDocumentSchema } from '@longeny/validators';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { DocumentController } from '../controllers/document.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

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
    .post('/upload', controller.upload, {
      body: documented(uploadDocumentSchema, {
        title: 'HbA1c and lipid panel',
        fileName: 'panel-2026-09-01.pdf',
        fileSize: 184320,
        mimeType: 'application/pdf',
        documentType: 'lab_report',
        reportedAt: '2026-09-01T08:30:00Z',
      }),
      detail: {
        tags: ['documents'],
        summary: 'Declare an upload and get a presigned link',
        description:
          'Returns a link valid for 15 minutes. The declared `fileSize` and `mimeType` are signed into it: the `PUT` must send exactly that `Content-Length` and `Content-Type`, or S3 refuses it. Maximum 50 MB; PDF, JPEG, PNG, TIFF and DICOM only.',
        security: [{ BearerAuth: [] }],
        requestBody: bodyDoc(uploadDocumentSchema),
      },
    })
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

  return new Elysia().use(
    new Elysia({ prefix: '/documents' }).use(providerRoutes).use(authRoutes).use(consentRoutes),
  );
}
