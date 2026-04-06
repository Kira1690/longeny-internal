import { Elysia } from 'elysia';
import { verifyHmac } from '@longeny/middleware';
import type { InternalController } from '../controllers/internal.controller.js';

export function createInternalRoutes(
  controller: InternalController,
  hmacSecret: string,
): Elysia {
  return new Elysia({ prefix: '/internal' })
    .use(verifyHmac(hmacSecret))
    .get('/gdpr/user-data/:userId', controller.getUserData)
    .delete('/gdpr/user-data/:userId', controller.deleteUserData);
}
