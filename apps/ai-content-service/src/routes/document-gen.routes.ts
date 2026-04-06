import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { DocumentGenController } from '../controllers/document-gen.controller.js';

export function createDocumentGenRoutes(controller: DocumentGenController): Elysia {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');

  return new Elysia({ prefix: '/ai/documents' })
    .use(authRequired)
    .use(providerRequired)
    .post('/prescription', controller.generatePrescription)
    .post('/nutrition-plan', controller.generateNutritionPlan)
    .post('/training-plan', controller.generateTrainingPlan)
    .get('/', controller.listDocuments)
    .get('/:id', controller.getDocument)
    .patch('/:id/finalize', controller.finalizeDocument)
    .post('/:id/share', controller.shareDocument)
    .get('/:id/download', controller.downloadDocument);
}
