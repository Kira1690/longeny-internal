import { verifyHmac } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { InternalController } from '../controllers/internal.controller.js';

export function createInternalRoutes(controller: InternalController) {
  return new Elysia({ prefix: '/internal' })
    .use(verifyHmac(config.HMAC_SECRET))
    .post('/embeddings/generate', controller.generateEmbedding)
    .get('/gdpr/user-data/:userId', controller.getUserData)
    .delete('/gdpr/user-data/:userId', controller.deleteUserData);
}
