import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { ProviderController } from '../controllers/provider.controller.js';
import {
  providerRegisterSchema,
  updateProviderProfileSchema,
  verificationDocumentSchema,
  availabilityOverrideSchema,
  programSchema,
  productSchema,
} from '../validators/index.js';

export function createProviderRoutes(controller: ProviderController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');

  return new Elysia({ prefix: '/providers' })
    // Public endpoints
    .get('/categories', controller.listCategories)
    .get('/', controller.listProviders)
    .get('/:id', controller.getPublicProfile)
    .get('/:id/slots', controller.getSlots)
    .get('/:id/programs', controller.getProviderPrograms)
    .get('/:id/products', controller.getProviderProducts)
    .get('/:id/availability', controller.getPublicAvailability)
    // Auth-required endpoints
    .use(authRequired)
    .post('/register', controller.register, { body: providerRegisterSchema })
    .use(providerRequired)
    .get('/me', controller.getOwnProfile)
    .put('/me', controller.updateProfile, { body: updateProviderProfileSchema })
    .post('/me/verification', controller.submitVerification, { body: verificationDocumentSchema })
    .get('/me/availability', controller.getAvailability)
    .put('/me/availability', controller.setAvailability)
    .post('/me/availability/overrides', controller.addAvailabilityOverride, { body: availabilityOverrideSchema })
    .delete('/me/availability/overrides/:id', controller.removeAvailabilityOverride)
    .get('/me/programs', controller.getOwnPrograms)
    .post('/me/programs', controller.createProgram, { body: programSchema })
    .put('/me/programs/:id', controller.updateProgram)
    .delete('/me/programs/:id', controller.deleteProgram)
    .post('/me/products', controller.createProduct, { body: productSchema })
    .put('/me/products/:id', controller.updateProduct)
    .delete('/me/products/:id', controller.deleteProduct)
    .get('/me/products', controller.getOwnProducts)
    .get('/me/stats', controller.getProviderStats);
}
