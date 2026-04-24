import { Elysia } from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import type { UserController } from '../controllers/user.controller.js';
import {
  updateProfileSchema,
  healthProfileSchema,
  preferencesSchema,
  onboardingStepSchema,
} from '../validators/index.js';

const bearer = { security: [{ BearerAuth: [] }] };

export function createUserRoutes(controller: UserController) {
  const authRequired = requireAuth();
  const adminRequired = requireRole('admin');

  return new Elysia({ prefix: '/users' })
    .use(authRequired)
    .get('/me', controller.getProfile, {
      detail: { tags: ['Users'], summary: 'Get own profile', ...bearer },
    })
    .put('/me', controller.updateProfile, {
      body: updateProfileSchema,
      detail: { tags: ['Users'], summary: 'Update own profile', ...bearer },
    })
    .delete('/me', controller.deleteAccount, {
      detail: { tags: ['Users'], summary: 'Soft-delete own account', ...bearer },
    })
    .post('/me/avatar', controller.getAvatarUploadUrl, {
      detail: { tags: ['Users'], summary: 'Get presigned S3 URL for avatar upload', ...bearer },
    })
    .get('/me/health-profile', controller.getHealthProfile, {
      detail: { tags: ['Users'], summary: 'Get health profile', ...bearer },
    })
    .put('/me/health-profile', controller.updateHealthProfile, {
      body: healthProfileSchema,
      detail: { tags: ['Users'], summary: 'Update health profile', ...bearer },
    })
    .get('/me/preferences', controller.getPreferences, {
      detail: { tags: ['Users'], summary: 'Get preferences', ...bearer },
    })
    .put('/me/preferences', controller.updatePreferences, {
      body: preferencesSchema,
      detail: { tags: ['Users'], summary: 'Update preferences', ...bearer },
    })
    .post('/me/onboarding', controller.saveOnboardingStep, {
      body: onboardingStepSchema,
      detail: { tags: ['Users'], summary: 'Save onboarding step', ...bearer },
    })
    .get('/me/onboarding', controller.getOnboardingState, {
      detail: { tags: ['Users'], summary: 'Get onboarding state', ...bearer },
    })
    .post('/me/onboarding/complete', controller.completeOnboarding, {
      detail: { tags: ['Users'], summary: 'Complete onboarding', ...bearer },
    })
    .get('/me/consents', controller.getConsents, {
      detail: { tags: ['Users'], summary: 'Get consent flags (read-only view)', ...bearer },
    })
    .get('/me/data-export', controller.requestDataExport, {
      detail: { tags: ['Users'], summary: 'Request DSAR data export', ...bearer },
    })
    .post('/me/data-export/portable', controller.getPortableExport, {
      detail: { tags: ['Users'], summary: 'Get portable data export (JSON or CSV)', ...bearer },
    })
    .delete('/me/gdpr-erase', controller.requestGdprErasure, {
      detail: { tags: ['Users'], summary: 'Request full GDPR erasure', ...bearer },
    })
    .get('/me/gdpr-erase', controller.getGdprErasureStatus, {
      detail: { tags: ['Users'], summary: 'Check GDPR erasure request status', ...bearer },
    })
    .post('/me/gdpr-erase/cancel', controller.cancelGdprErasure, {
      detail: { tags: ['Users'], summary: 'Cancel pending GDPR erasure', ...bearer },
    })
    .use(adminRequired)
    .get('/:id', controller.getUserById, {
      detail: { tags: ['Admin'], summary: 'Get any user by ID (admin only)', ...bearer },
    })
    .get('', controller.listUsers, {
      detail: { tags: ['Admin'], summary: 'List all users (admin only)', ...bearer },
    });
}
