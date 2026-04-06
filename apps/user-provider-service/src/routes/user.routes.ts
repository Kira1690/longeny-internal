import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { UserController } from '../controllers/user.controller.js';
import {
  updateProfileSchema,
  healthProfileSchema,
  preferencesSchema,
  onboardingStepSchema,
} from '../validators/index.js';

export function createUserRoutes(controller: UserController) {
  const authRequired = requireAuth();
  const adminRequired = requireRole('admin');

  return new Elysia({ prefix: '/users' })
    .use(authRequired)
    .get('/me', controller.getProfile)
    .put('/me', controller.updateProfile, { body: updateProfileSchema })
    .delete('/me', controller.deleteAccount)
    .post('/me/avatar', controller.getAvatarUploadUrl)
    .get('/me/health-profile', controller.getHealthProfile)
    .put('/me/health-profile', controller.updateHealthProfile, { body: healthProfileSchema })
    .get('/me/preferences', controller.getPreferences)
    .put('/me/preferences', controller.updatePreferences, { body: preferencesSchema })
    .post('/me/onboarding', controller.saveOnboardingStep, { body: onboardingStepSchema })
    .get('/me/onboarding', controller.getOnboardingState)
    .post('/me/onboarding/complete', controller.completeOnboarding)
    .get('/me/consents', controller.getConsents)
    .get('/me/data-export', controller.requestDataExport)
    .delete('/me/gdpr-erase', controller.requestGdprErasure)
    .get('/me/gdpr-erase', controller.getGdprErasureStatus)
    .post('/me/gdpr-erase/cancel', controller.cancelGdprErasure)
    .post('/me/data-export/portable', controller.getPortableExport)
    .use(adminRequired)
    .get('/:id', controller.getUserById)
    .get('/', controller.listUsers);
}
