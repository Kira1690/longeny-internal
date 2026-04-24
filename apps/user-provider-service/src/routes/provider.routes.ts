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

const bearer = { security: [{ BearerAuth: [] }] };

export function createProviderRoutes(controller: ProviderController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole('provider');

  return new Elysia({ prefix: '/providers' })
    // Public endpoints
    .get('/categories', controller.listCategories, {
      detail: { tags: ['Providers'], summary: 'List provider categories' },
    })
    .get('', controller.listProviders, {
      detail: { tags: ['Providers'], summary: 'List active providers (public)' },
    })
    .get('/:id', controller.getPublicProfile, {
      detail: { tags: ['Providers'], summary: 'Get provider public profile' },
    })
    .get('/:id/slots', controller.getSlots, {
      detail: { tags: ['Providers'], summary: 'Get available booking slots for a provider' },
    })
    .get('/:id/programs', controller.getProviderPrograms, {
      detail: { tags: ['Providers'], summary: 'Get programs offered by a provider' },
    })
    .get('/:id/products', controller.getProviderProducts, {
      detail: { tags: ['Providers'], summary: 'Get products offered by a provider' },
    })
    .get('/:id/availability', controller.getPublicAvailability, {
      detail: { tags: ['Providers'], summary: 'Get provider availability schedule' },
    })
    // Auth-required endpoints
    .use(authRequired)
    .post('/register', controller.register, {
      body: providerRegisterSchema,
      detail: { tags: ['Provider Management'], summary: 'Register as a provider', ...bearer },
    })
    .use(providerRequired)
    .get('/me', controller.getOwnProfile, {
      detail: { tags: ['Provider Management'], summary: 'Get own provider profile', ...bearer },
    })
    .put('/me', controller.updateProfile, {
      body: updateProviderProfileSchema,
      detail: { tags: ['Provider Management'], summary: 'Update own provider profile', ...bearer },
    })
    .post('/me/verification', controller.submitVerification, {
      body: verificationDocumentSchema,
      detail: { tags: ['Provider Management'], summary: 'Submit verification document (get presigned S3 URL)', ...bearer },
    })
    .get('/me/availability', controller.getAvailability, {
      detail: { tags: ['Provider Management'], summary: 'Get own availability', ...bearer },
    })
    .put('/me/availability', controller.setAvailability, {
      detail: { tags: ['Provider Management'], summary: 'Set weekly availability schedule', ...bearer },
    })
    .post('/me/availability/overrides', controller.addAvailabilityOverride, {
      body: availabilityOverrideSchema,
      detail: { tags: ['Provider Management'], summary: 'Add availability override (block or add a specific date)', ...bearer },
    })
    .delete('/me/availability/overrides/:id', controller.removeAvailabilityOverride, {
      detail: { tags: ['Provider Management'], summary: 'Remove availability override', ...bearer },
    })
    .get('/me/programs', controller.getOwnPrograms, {
      detail: { tags: ['Provider Management'], summary: 'List own programs', ...bearer },
    })
    .post('/me/programs', controller.createProgram, {
      body: programSchema,
      detail: { tags: ['Provider Management'], summary: 'Create a program', ...bearer },
    })
    .put('/me/programs/:id', controller.updateProgram, {
      detail: { tags: ['Provider Management'], summary: 'Update a program', ...bearer },
    })
    .delete('/me/programs/:id', controller.deleteProgram, {
      detail: { tags: ['Provider Management'], summary: 'Delete a program', ...bearer },
    })
    .post('/me/products', controller.createProduct, {
      body: productSchema,
      detail: { tags: ['Provider Management'], summary: 'Create a product', ...bearer },
    })
    .put('/me/products/:id', controller.updateProduct, {
      detail: { tags: ['Provider Management'], summary: 'Update a product', ...bearer },
    })
    .delete('/me/products/:id', controller.deleteProduct, {
      detail: { tags: ['Provider Management'], summary: 'Delete a product', ...bearer },
    })
    .get('/me/products', controller.getOwnProducts, {
      detail: { tags: ['Provider Management'], summary: 'List own products', ...bearer },
    })
    .get('/me/stats', controller.getProviderStats, {
      detail: { tags: ['Provider Management'], summary: 'Get own provider stats', ...bearer },
    });
}
