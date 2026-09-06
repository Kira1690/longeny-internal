import { auditLog, requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import type { UserController } from '../controllers/user.controller.js';
import { profileContext } from '../middleware/profile-context.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import type { ProfileService } from '../services/profile.service.js';
import {
  healthProfileSchema,
  onboardingStepSchema,
  preferencesSchema,
  updateProfileSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };

// ── Documentation fragments ──────────────────────────────────────────────────

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

/**
 * The account row is created by the auth service's user-registered event, so a
 * token can outrun it by a moment; every /users/me route answers 404 in that
 * window rather than inventing a row.
 */
const noUserRow = errorDoc('No user record for this token yet', 'NOT_FOUND');

const meErrors: OpenApiFragment = { 401: unauthorized, 404: noUserRow };

/**
 * Onboarding runs under a stricter `requireAuth` that refuses a token it cannot
 * revocation-check, and under the profile resolver — so it carries two codes the
 * sibling /users routes cannot return.
 */
const onboardingErrors: OpenApiFragment = {
  401: unauthorized,
  404: errorDoc(
    '`X-Active-Profile-Id` names a profile this account does not own (or the account has no profile yet) — a profile belonging to somebody else is deliberately indistinguishable from one that does not exist',
    'NOT_FOUND',
  ),
  503: errorDoc(
    'The server could not check whether the token was revoked (Redis unavailable). Onboarding is health data and fails closed rather than honour a possibly-revoked token — retry shortly.',
    'REVOCATION_CHECK_UNAVAILABLE',
  ),
};

const validationError = errorDoc('Request body failed validation', 'VALIDATION_ERROR');

const activeProfileHeader: OpenApiFragment = {
  name: 'X-Active-Profile-Id',
  in: 'header',
  required: false,
  schema: { type: 'string', format: 'uuid' },
  description:
    'Which of the account’s profiles this intake is about. Omit it and the request acts as the ' +
    'account owner’s own `self` profile. Ownership is re-checked on every request — activating ' +
    'a profile is not a session — and a profile the account does not own answers 404, never 403.',
};

const onboardingParams: OpenApiFragment = { parameters: [activeProfileHeader] };

const USER_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    auth_id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    first_name: { type: 'string', nullable: true },
    last_name: { type: 'string', nullable: true },
    avatar_url: { type: 'string', nullable: true },
    timezone: { type: 'string', nullable: true },
    locale: { type: 'string', nullable: true },
    has_phone: { type: 'boolean', description: 'Phone is encrypted at rest and never returned' },
    onboarding_completed: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'deleted'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const HEALTH_PROFILE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    date_of_birth: { type: 'string', nullable: true, example: '1988-04-02' },
    gender: {
      type: 'string',
      nullable: true,
      enum: ['male', 'female', 'non_binary', 'prefer_not_to_say'],
    },
    height_cm: { type: 'number', nullable: true },
    weight_kg: { type: 'number', nullable: true },
    fitness_level: {
      type: 'string',
      nullable: true,
      enum: ['beginner', 'intermediate', 'advanced', 'elite'],
    },
    medical_conditions: { type: 'array', items: { type: 'string' }, nullable: true },
    medications: { type: 'array', items: { type: 'string' }, nullable: true },
    allergies: { type: 'array', items: { type: 'string' }, nullable: true },
    goals: { type: 'array', items: { type: 'string' }, nullable: true },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const PREFERENCES_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    notifications: {
      type: 'object',
      properties: {
        email: { type: 'boolean' },
        sms: { type: 'boolean' },
        push: { type: 'boolean' },
        inApp: { type: 'boolean' },
      },
    },
    language: { type: 'string', nullable: true },
    timezone: { type: 'string', nullable: true },
    theme: { type: 'string', enum: ['light', 'dark', 'system'], nullable: true },
  },
};

const ONBOARDING_STATE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    profileId: { type: 'string', format: 'uuid' },
    currentStep: { type: 'integer' },
    completedSteps: { type: 'array', items: { type: 'integer' } },
    data: { type: 'object', additionalProperties: true },
    completed: { type: 'boolean' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export function createUserRoutes(controller: UserController, profileService: ProfileService) {
  const authRequired = requireAuth();
  const adminRequired = requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);

  /**
   * Onboarding is intake about a subject of care, so it is scoped to the active
   * profile rather than to the account. Split into its own instance because
   * these three routes need guards the rest of /users does not: a stricter auth
   * that refuses a token it cannot revocation-check, the profile resolver, and
   * a PHI audit row per request. The guards are `scoped`, so they stop at this
   * instance and never reach the sibling /users routes.
   *
   * Paths are spelled out rather than set as a prefix: a prefixed child would
   * register `/users/me/onboarding/` and leave existing clients depending on
   * Elysia's loose trailing-slash matching.
   */
  const onboardingRoutes = new Elysia({ name: 'user-onboarding' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(profileContext(profileService))
    .use(
      auditLog({
        action: 'onboarding.access',
        resourceType: 'onboarding',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .post('/me/onboarding', controller.saveOnboardingStep, {
      body: documented(onboardingStepSchema),
      detail: {
        tags: ['Users'],
        summary: 'Save one onboarding step',
        description:
          'Intake is **scoped to the acting profile**, not to the account: send ' +
          '`X-Active-Profile-Id` to onboard a family member, or omit it to onboard the account ' +
          'owner. Each profile has its own independent onboarding state, so a parent added as a ' +
          'dependent starts from step 1 even though the account owner has finished.\n\n' +
          '`data` is an open bag whose shape is decided by the step. Steps can be saved out of ' +
          'order and re-saved; the latest save for a step wins.\n\n' +
          'Because this is health data the auth guard fails **closed**: if the server cannot ' +
          'check whether the token was revoked, it answers 503 rather than trusting it. Every ' +
          'request, refusals included, writes a PHI audit row.',
        ...bearer,
        ...onboardingParams,
        requestBody: bodyDoc(onboardingStepSchema),
        responses: {
          200: okDoc('Onboarding state after saving the step', ONBOARDING_STATE_SHAPE),
          400: validationError,
          ...onboardingErrors,
        },
      },
    })
    .get('/me/onboarding', controller.getOnboardingState, {
      detail: {
        tags: ['Users'],
        summary: 'Get onboarding state for the acting profile',
        description:
          'Which steps are done and what was saved, for the profile named by ' +
          '`X-Active-Profile-Id` (the account owner’s own profile when the header is absent). ' +
          'Use it to resume where the user left off. A profile that has never started ' +
          'onboarding answers 200 with an empty state, not 404 — a 404 here means the *profile* ' +
          'is not this account’s.',
        ...bearer,
        ...onboardingParams,
        responses: {
          200: okDoc('Current onboarding state for the acting profile', ONBOARDING_STATE_SHAPE),
          ...onboardingErrors,
        },
      },
    })
    .post('/me/onboarding/complete', controller.completeOnboarding, {
      detail: {
        tags: ['Users'],
        summary: 'Finish onboarding for the acting profile',
        description:
          'Marks the acting profile’s intake complete and publishes ' +
          '`patient.onboarding.completed`, which is what persists the collected answers into the ' +
          'durable profile and hands them to the AI surfaces. Completing one profile leaves ' +
          'every other profile on the account untouched. There is no request body.',
        ...bearer,
        ...onboardingParams,
        responses: {
          200: okDoc('Onboarding marked complete', {
            ...ONBOARDING_STATE_SHAPE,
            properties: {
              ...ONBOARDING_STATE_SHAPE.properties,
              completed: { type: 'boolean', example: true },
            },
          }),
          ...onboardingErrors,
        },
      },
    });

  return (
    new Elysia({ prefix: '/users' })
      .use(authRequired)

      .get('/me', controller.getProfile, {
        detail: {
          tags: ['Users'],
          summary: 'Get the signed-in user’s account record',
          description:
            'The account itself, not a family profile — for those use `/profiles`. `phone` is ' +
            'encrypted at rest and never returned; `has_phone` says whether one is stored.',
          ...bearer,
          responses: {
            200: okDoc('The account record', USER_SHAPE),
            ...meErrors,
          },
        },
      })

      .put('/me', controller.updateProfile, {
        body: documented(updateProfileSchema),
        detail: {
          tags: ['Users'],
          summary: 'Update the signed-in user’s account record',
          description:
            'Partial update — send only what changes. Changing the account name does not rename ' +
            'the owner’s `self` profile; that is a separate record under `/profiles`.',
          ...bearer,
          requestBody: bodyDoc(updateProfileSchema),
          responses: {
            200: okDoc('The account record after the update', USER_SHAPE),
            400: validationError,
            ...meErrors,
          },
        },
      })

      .delete('/me', controller.deleteAccount, {
        detail: {
          tags: ['Users'],
          summary: 'Soft-delete the signed-in user’s account',
          description:
            'Marks the account deleted and hides it from the product. It is **not** an erasure: ' +
            'the data is still there and still subject to retention rules. For a real GDPR ' +
            'erasure use `DELETE /users/me/gdpr-erase`, which has a cancellable grace period.',
          ...bearer,
          responses: {
            200: okDoc('Account soft-deleted', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string', example: 'deleted' },
              },
            }),
            ...meErrors,
          },
        },
      })

      .post('/me/avatar', controller.getAvatarUploadUrl, {
        detail: {
          tags: ['Users'],
          summary: 'Get a presigned S3 URL for an avatar upload',
          description:
            'Two-step upload: call this, then `PUT` the image bytes straight to the returned ' +
            'URL — the file never passes through this API. The URL is short-lived, so request ' +
            'it when the user picks a file, not before. Save the returned public URL onto the ' +
            'profile with `PUT /users/me`. There is no request body.',
          ...bearer,
          responses: {
            200: okDoc('Presigned upload URL plus the eventual public URL', {
              type: 'object',
              properties: {
                uploadUrl: { type: 'string', description: 'PUT the image bytes here' },
                publicUrl: { type: 'string', description: 'Where the image will be readable' },
                expiresIn: { type: 'integer', description: 'Seconds until `uploadUrl` expires' },
              },
            }),
            ...meErrors,
          },
        },
      })

      .get('/me/health-profile', controller.getHealthProfile, {
        detail: {
          tags: ['Users'],
          summary: 'Get the account owner’s health profile',
          description:
            'Height, weight, conditions, medications, allergies and goals for the **account ' +
            'owner**. This route is not profile-scoped — it does not read ' +
            '`X-Active-Profile-Id`, and a dependent’s health data lives under `/profiles` and ' +
            '`/progress` instead.',
          ...bearer,
          responses: {
            200: okDoc('Health profile', HEALTH_PROFILE_SHAPE),
            ...meErrors,
          },
        },
      })

      .put('/me/health-profile', controller.updateHealthProfile, {
        body: documented(healthProfileSchema),
        detail: {
          tags: ['Users'],
          summary: 'Update the account owner’s health profile',
          description:
            'Partial update — send only what changes. Array fields (`medicalConditions`, ' +
            '`medications`, `allergies`, `goals`) are **replaced wholesale**, not merged, so ' +
            'send the complete list each time. Not profile-scoped.',
          ...bearer,
          requestBody: bodyDoc(healthProfileSchema),
          responses: {
            200: okDoc('Health profile after the update', HEALTH_PROFILE_SHAPE),
            400: validationError,
            ...meErrors,
          },
        },
      })

      .get('/me/preferences', controller.getPreferences, {
        detail: {
          tags: ['Users'],
          summary: 'Get the account’s app preferences',
          description: 'Notification channels, language, timezone and theme.',
          ...bearer,
          responses: {
            200: okDoc('Preferences', PREFERENCES_SHAPE),
            ...meErrors,
          },
        },
      })

      .put('/me/preferences', controller.updatePreferences, {
        body: documented(preferencesSchema),
        detail: {
          tags: ['Users'],
          summary: 'Update the account’s app preferences',
          description:
            'Partial update. The `notifications` object is replaced by what you send, so include ' +
            'every channel you want left on rather than only the one being toggled.',
          ...bearer,
          requestBody: bodyDoc(preferencesSchema),
          responses: {
            200: okDoc('Preferences after the update', PREFERENCES_SHAPE),
            400: validationError,
            ...meErrors,
          },
        },
      })

      .use(onboardingRoutes)

      .get('/me/consents', controller.getConsents, {
        detail: {
          tags: ['Users'],
          summary: 'Read-only view of the account’s consent flags',
          description:
            'A convenience mirror of what the auth service holds. Consents are **granted and ' +
            'withdrawn in the auth service** — `POST /auth/consents` and ' +
            '`DELETE /auth/consents/{type}` — not here.',
          ...bearer,
          responses: {
            200: okDoc('Consent flags', {
              type: 'object',
              additionalProperties: { type: 'boolean' },
            }),
            401: unauthorized,
          },
        },
      })

      .get('/me/data-export', controller.requestDataExport, {
        detail: {
          tags: ['Users'],
          summary: 'Request a DSAR data export',
          description:
            'Queues an asynchronous export of everything the platform holds about the account ' +
            'and answers immediately with the request record — the file arrives later, out of ' +
            'band. Only one export may be in flight at a time; asking again while one is ' +
            'running answers 409. For an immediate download use ' +
            '`POST /users/me/data-export/portable` instead.',
          ...bearer,
          responses: {
            200: okDoc('Export request queued', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                export_type: { type: 'string', example: 'dsar' },
                status: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] },
                requested_at: { type: 'string', format: 'date-time' },
              },
            }),
            409: errorDoc('An export request is already in progress', 'CONFLICT'),
            ...meErrors,
          },
        },
      })

      .post('/me/data-export/portable', controller.getPortableExport, {
        detail: {
          tags: ['Users'],
          summary: 'Get a portable data export inline (JSON or CSV)',
          description:
            'The GDPR portability answer, built and returned in the response rather than queued. ' +
            'Choose the shape with the `format` query parameter. It also records a `portable` ' +
            'export request on the side for the audit trail, and a failure to record that does ' +
            'not fail the call. There is no request body despite the POST.',
          ...bearer,
          parameters: [
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
              description: 'Serialisation of the exported data',
            },
          ],
          responses: {
            200: okDoc('The exported data', {
              type: 'object',
              description: 'JSON object, or CSV text when `format=csv`',
              additionalProperties: true,
            }),
            ...meErrors,
          },
        },
      })

      .delete('/me/gdpr-erase', controller.requestGdprErasure, {
        detail: {
          tags: ['Users'],
          summary: 'Request full GDPR erasure (starts a grace period)',
          description:
            'Schedules the account for erasure rather than deleting anything now: a grace period ' +
            'runs first, during which `POST /users/me/gdpr-erase/cancel` can call it off. Answers ' +
            '**201** with the request record. Only one erasure request may be open at a time. ' +
            'Erasure cascades across services and is irreversible once the grace period ends — ' +
            'confirm hard in the UI before calling it.',
          ...bearer,
          responses: {
            201: okDoc('Erasure scheduled', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['pending', 'processing', 'completed'] },
                requested_at: { type: 'string', format: 'date-time' },
                scheduled_for: {
                  type: 'string',
                  format: 'date-time',
                  description: 'When the grace period ends and erasure runs',
                },
              },
            }),
            409: errorDoc('An erasure request is already in progress', 'CONFLICT'),
            ...meErrors,
          },
        },
      })

      .get('/me/gdpr-erase', controller.getGdprErasureStatus, {
        detail: {
          tags: ['Users'],
          summary: 'Check the status of a GDPR erasure request',
          description:
            'Poll this to show the user how long is left to change their mind. An account with ' +
            'no erasure pending still answers 200 — read the payload rather than treating any ' +
            'error as "none pending".',
          ...bearer,
          responses: {
            200: okDoc('Erasure status, or an empty state when nothing is pending', {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string' },
                requested_at: { type: 'string', format: 'date-time' },
                scheduled_for: { type: 'string', format: 'date-time' },
                cancellable: { type: 'boolean' },
              },
            }),
            ...meErrors,
          },
        },
      })

      .post('/me/gdpr-erase/cancel', controller.cancelGdprErasure, {
        detail: {
          tags: ['Users'],
          summary: 'Cancel a pending GDPR erasure',
          description:
            'Only works while the grace period is still running — once it has expired the ' +
            'request answers 400 and the erasure proceeds. There is no request body.',
          ...bearer,
          responses: {
            200: okDoc('Erasure cancelled', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string', example: 'cancelled' },
              },
            }),
            400: errorDoc(
              'The grace period has expired; the erasure can no longer be cancelled',
              'BAD_REQUEST',
            ),
            401: unauthorized,
            404: errorDoc('No user record, or no erasure request to cancel', 'NOT_FOUND'),
          },
        },
      })

      // `requireRole` is applied inline, so it guards every route declared after
      // it on this instance — the two admin lookups below, and nothing above.
      .use(adminRequired)

      .get('/:id', controller.getUserById, {
        detail: {
          tags: ['Admin'],
          summary: 'Get any user by id (admin only)',
          description:
            'Admin lookup by internal user id — not the auth credential id. Requires the ' +
            '`admin` role; `super_admin` alone does not satisfy this guard.',
          ...bearer,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Internal user id',
            },
          ],
          responses: {
            200: okDoc('The user record', USER_SHAPE),
            401: unauthorized,
            403: errorDoc('Caller does not hold the `admin` role', 'FORBIDDEN'),
            404: errorDoc('No such user', 'NOT_FOUND'),
          },
        },
      })

      .get('', controller.listUsers, {
        detail: {
          tags: ['Admin'],
          summary: 'List all users (admin only)',
          description:
            'Paginated admin directory. Requires the `admin` role; `super_admin` alone does not ' +
            'satisfy this guard.',
          ...bearer,
          parameters: [
            {
              name: 'search',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Free-text match on name or email',
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['active', 'deleted'] },
            },
            {
              name: 'page',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, default: 1 },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, default: 20 },
            },
          ],
          responses: {
            200: {
              description: 'Page of users',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { type: 'array', items: USER_SHAPE },
                      pagination: {
                        type: 'object',
                        properties: {
                          page: { type: 'integer' },
                          limit: { type: 'integer' },
                          total: { type: 'integer' },
                          totalPages: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            401: unauthorized,
            403: errorDoc('Caller does not hold the `admin` role', 'FORBIDDEN'),
          },
        },
      })
  );
}
