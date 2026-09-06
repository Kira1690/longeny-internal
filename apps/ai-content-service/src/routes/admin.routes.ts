import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import type { AdminController } from '../controllers/admin.controller.js';

export function createAdminRoutes(controller: AdminController) {
  const authRequired = requireAuth();
  const adminRequired = requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);

  return new Elysia({ prefix: '/ai' })
    .use(authRequired)
    .use(adminRequired)
    .post('/embeddings/generate', controller.generateEmbeddings)
    .get('/embeddings/status', controller.getEmbeddingStatus)
    .get('/usage', controller.getUsageStats)
    .get('/prompts', controller.listPromptTemplates)
    .put('/prompts/:id', controller.updatePromptTemplate);
}
