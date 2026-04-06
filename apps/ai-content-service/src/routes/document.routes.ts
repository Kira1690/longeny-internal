import { Elysia } from 'elysia';
import { requireAuth, requireRole, requireConsent } from '@longeny/middleware';
import type { DocumentController } from '../controllers/document.controller.js';

export function createDocumentRoutes(controller: DocumentController): Elysia {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');
  const consentRequired = requireConsent('data_sharing_providers');

  // Provider-only section
  const providerRoutes = new Elysia()
    .use(authRequired)
    .use(providerRequired)
    .get('/shared-with-me', controller.sharedWithMe)
    .get('/provider/:providerId/accessible', controller.getProviderAccessibleDocuments);

  // Auth-required general section
  const authRoutes = new Elysia()
    .use(authRequired)
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

  return new Elysia({ prefix: '/documents' })
    .use(providerRoutes)
    .use(authRoutes)
    .use(consentRoutes);
}
