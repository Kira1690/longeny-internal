import { Elysia } from 'elysia';
import { verifyHmac } from '@longeny/middleware';
import type { InternalController } from '../controllers/internal.controller.js';
import { config } from '../config/index.js';

export function createInternalRoutes(controller: InternalController) {
  return new Elysia({ prefix: '/internal' })
    .use(verifyHmac(config.HMAC_SECRET))
    .get('/users/:id', controller.getUserById)
    .get('/users/:id/health-profile', controller.getUserHealthProfile)
    .get('/providers', controller.listProviders)
    .get('/providers/:id', controller.getProviderById)
    .get('/providers/:id/full', controller.getProviderFull)
    .get('/providers/:id/availability', controller.getProviderAvailability)
    .get('/gdpr/user-data/:userId', controller.getGdprUserData)
    .delete('/gdpr/user-data/:userId', controller.deleteGdprUserData);
}
