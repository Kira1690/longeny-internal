import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { AdminController } from '../controllers/admin.controller.js';

export function createAdminRoutes(controller: AdminController): Elysia {
  const authRequired = requireAuth();
  const adminRequired = requireRole('admin');

  return new Elysia({ prefix: '/ai' })
    .use(authRequired)
    .use(adminRequired)
    .post('/embeddings/generate', controller.generateEmbeddings)
    .get('/embeddings/status', controller.getEmbeddingStatus)
    .get('/usage', controller.getUsageStats)
    .get('/prompts', controller.listPromptTemplates)
    .put('/prompts/:id', controller.updatePromptTemplate);
}
