import { auditLog, permissionGuard, rateLimit, requireAuth } from '@longeny/middleware';
import { Elysia } from 'elysia';
import type { ProfileController } from '../controllers/profile.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import {
  caregiverConsentSchema,
  createProfileSchema,
  notificationTargetSchema,
  updateProfileScopedSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Profiles'];

// ── OpenAPI shapes for documented responses ──────────────────────────────────

const PROFILE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    account_user_id: { type: 'string', format: 'uuid' },
    relation: {
      type: 'string',
      enum: ['self', 'father', 'mother', 'spouse', 'child', 'sibling', 'other'],
    },
    is_self: { type: 'boolean' },
    first_name: { type: 'string' },
    last_name: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    gender: { type: 'string', nullable: true },
    avatar_url: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'inactive'] },
    has_phone: { type: 'boolean', description: 'Phone is encrypted at rest and never returned' },
    has_date_of_birth: {
      type: 'boolean',
      description: 'DOB is encrypted at rest and never returned',
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const RRO_STATE_SHAPE: OpenApiFragment = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    current_state: { type: 'string', enum: ['intake', 'reverse', 'restore', 'optimise'] },
    goal: { type: 'string', nullable: true },
    entered_at: { type: 'string', format: 'date-time' },
  },
};

const TRANSITION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    from_state: {
      type: 'string',
      nullable: true,
      enum: ['intake', 'reverse', 'restore', 'optimise'],
    },
    to_state: { type: 'string', enum: ['intake', 'reverse', 'restore', 'optimise'] },
    reason: { type: 'string', nullable: true },
    source: { type: 'string', enum: ['ai_classifier', 'clinician', 'system'] },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const CONSENT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    consent_type: {
      type: 'string',
      example: 'health_data',
      description: 'e.g. health_data, ai_analysis, care_coordination, notifications',
    },
    status: { type: 'string', enum: ['granted', 'revoked'] },
    granted_by: { type: 'string', format: 'uuid' },
    granted_at: { type: 'string', format: 'date-time' },
    revoked_at: { type: 'string', format: 'date-time', nullable: true },
    document_url: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
  },
};

const NOTIFICATION_LOG_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    target_id: { type: 'string', format: 'uuid', nullable: true },
    channel: { type: 'string', enum: ['sms', 'email', 'calendar'] },
    subject: { type: 'string', nullable: true },
    body: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'sent', 'failed'] },
    sent_at: { type: 'string', format: 'date-time', nullable: true },
    error: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const PROFILE_EXAMPLE = {
  id: '66de1c77-160a-4ca4-b674-53275dc0b66e',
  account_user_id: '11111111-1111-1111-1111-111111111111',
  relation: 'father',
  is_self: false,
  first_name: 'Ramesh',
  last_name: 'Dafada',
  email: 'ramesh@example.com',
  gender: 'male',
  status: 'active',
  has_phone: true,
  has_date_of_birth: true,
};

const idParam: OpenApiFragment = {
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: 'Profile id (must belong to the authenticated account)',
    },
  ],
};

const ownershipErrors: OpenApiFragment = {
  401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
  403: errorDoc('Token lacks the permission this route requires', 'FORBIDDEN'),
  404: errorDoc(
    'Profile not found, or owned by another account — the two are deliberately indistinguishable',
    'NOT_FOUND',
  ),
};

export function createProfileRoutes(controller: ProfileController) {
  return (
    new Elysia({ prefix: '/profiles' })
      // Health data: a revoked token must not be honoured because Redis is down.
      .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
      // Every request here — including denials — lands in phi_access_log.
      .use(
        auditLog({
          action: 'profile.access',
          resourceType: 'profile',
          purpose: 'care_delivery',
          sink: writePhiAccessLog,
        }),
      )
      // Per account, not per IP: a family behind one address must not exhaust a
      // shared budget, and one account must not escape its own by reconnecting.
      .use(
        rateLimit({
          windowMs: 60_000,
          max: 120,
          keyPrefix: 'profiles',
          by: 'account',
        }),
      )

      .get('', controller.listProfiles, {
        beforeHandle: permissionGuard('profiles:read'),
        detail: {
          tags: TAGS,
          summary: 'List profiles under the account',
          description:
            'Returns every profile owned by the authenticated account. The account owner’s `self` profile is created automatically on first call.',
          ...bearer,
          responses: {
            200: okDoc('Profiles owned by this account', { type: 'array', items: PROFILE_SHAPE }, [
              PROFILE_EXAMPLE,
            ]),
            401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          },
        },
      })

      .post('', controller.createProfile, {
        beforeHandle: permissionGuard('profiles:write'),
        body: documented(createProfileSchema, {
          relation: 'mother',
          firstName: 'Sunita',
          lastName: 'Sharma',
          email: 'sunita@example.com',
          phone: '+919812345678',
          dateOfBirth: '1962-03-04',
          gender: 'female',
          goal: 'walk without knee pain',
        }),
        detail: {
          tags: TAGS,
          summary: 'Create a family/dependent profile (no login)',
          description:
            'Creates a dependent profile (e.g. a parent). Dependents have **no credentials** — they are reached only through notification targets. `phone` and `dateOfBirth` are encrypted at rest and never returned; the response exposes `has_phone` / `has_date_of_birth` instead. The new profile starts in RRO state `intake`.',
          ...bearer,
          requestBody: bodyDoc(createProfileSchema),
          responses: {
            201: okDoc(
              'Profile created, with its initial RRO state',
              {
                ...PROFILE_SHAPE,
                properties: { ...PROFILE_SHAPE.properties, rroState: RRO_STATE_SHAPE },
              },
              {
                ...PROFILE_EXAMPLE,
                rroState: { current_state: 'intake', goal: 'Reverse type-2 diabetes' },
              },
            ),
            400: errorDoc(
              'Request body failed validation (VALIDATION_ERROR), or a self profile already exists for this account (BAD_REQUEST)',
              'VALIDATION_ERROR',
            ),
            401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          },
        },
      })

      .get('/:id', controller.getProfile, {
        beforeHandle: permissionGuard('profiles:read'),
        detail: {
          tags: TAGS,
          summary: 'Get one profile + current RRO state',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc('The profile and its current RRO state', {
              ...PROFILE_SHAPE,
              properties: { ...PROFILE_SHAPE.properties, rroState: RRO_STATE_SHAPE },
            }),
            ...ownershipErrors,
          },
        },
      })

      .patch('/:id', controller.updateProfile, {
        beforeHandle: permissionGuard('profiles:write'),
        body: documented(updateProfileScopedSchema, {
          notes: 'Lives in Pune. Prefers morning calls.',
          phone: '+919812345678',
        }),
        detail: {
          tags: TAGS,
          summary: 'Update a profile',
          description: 'Partial update — send only the fields you want to change.',
          ...bearer,
          ...idParam,
          requestBody: bodyDoc(updateProfileScopedSchema),
          responses: {
            200: okDoc('Updated profile', PROFILE_SHAPE, PROFILE_EXAMPLE),
            ...ownershipErrors,
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          },
        },
      })

      .delete('/:id', controller.deactivateProfile, {
        beforeHandle: permissionGuard('profiles:write'),
        detail: {
          tags: TAGS,
          summary: 'Deactivate a profile (soft delete)',
          description:
            'Sets `status` to `inactive`. The account owner’s `self` profile cannot be deactivated.',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc(
              'Profile deactivated',
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  status: { type: 'string', example: 'inactive' },
                },
              },
              { id: '66de1c77-160a-4ca4-b674-53275dc0b66e', status: 'inactive' },
            ),
            400: errorDoc('The self profile cannot be deactivated', 'BAD_REQUEST'),
            ...ownershipErrors,
          },
        },
      })

      .post('/:id/activate', controller.activateProfile, {
        beforeHandle: permissionGuard('profiles:write'),
        detail: {
          tags: TAGS,
          summary: 'Switch active profile (ownership guard)',
          description:
            'Proves the account may act as this profile and returns the active context. The model is stateless — after this call the client sends `X-Active-Profile-Id: <id>` on scoped requests. Every profile route re-checks ownership independently.',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc('Active profile context', {
              type: 'object',
              properties: {
                accountUserId: { type: 'string', format: 'uuid' },
                activeProfileId: { type: 'string', format: 'uuid' },
                profile: PROFILE_SHAPE,
                rroState: RRO_STATE_SHAPE,
              },
            }),
            400: errorDoc('Cannot switch to an inactive profile', 'BAD_REQUEST'),
            ...ownershipErrors,
          },
        },
      })

      .post('/:id/consent', controller.recordConsent, {
        beforeHandle: permissionGuard('consent:grant'),
        body: documented(caregiverConsentSchema, {
          consentType: 'care_coordination',
          status: 'granted',
          notes: 'Verbal consent recorded on call, 31 Aug.',
        }),
        detail: {
          tags: TAGS,
          summary: 'Record caregiver consent for a profile',
          description:
            'The account owner grants or revokes consent on the dependent’s behalf. Upserts by `consentType`, so re-posting the same type flips its status rather than creating a duplicate. Every change is written to an audit trail.',
          ...bearer,
          ...idParam,
          requestBody: bodyDoc(caregiverConsentSchema),
          responses: {
            201: okDoc('Consent recorded', CONSENT_SHAPE),
            ...ownershipErrors,
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          },
        },
      })

      .get('/:id/consent', controller.getConsent, {
        beforeHandle: permissionGuard('profiles:read'),
        detail: {
          tags: TAGS,
          summary: 'Read caregiver consent status',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc('Consent records, most recently updated first', {
              type: 'array',
              items: CONSENT_SHAPE,
            }),
            ...ownershipErrors,
          },
        },
      })

      .get('/:id/rro-state', controller.getRroState, {
        beforeHandle: permissionGuard('profiles:read'),
        detail: {
          tags: TAGS,
          summary: 'Current RRO state + transition history',
          description:
            'RRO states are `intake → reverse → restore → optimise`. Transitions are not restricted to a fixed order — the AI classifier or a clinician may move to any state. Returns the 20 most recent transitions.',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc('Current state plus recent transitions', {
              ...RRO_STATE_SHAPE,
              properties: {
                ...RRO_STATE_SHAPE.properties,
                history: { type: 'array', items: TRANSITION_SHAPE },
              },
            }),
            ...ownershipErrors,
          },
        },
      })

      .post('/:id/notification-targets', controller.addNotificationTarget, {
        beforeHandle: permissionGuard('profiles:write'),
        body: documented(notificationTargetSchema, {
          channel: 'email',
          destination: 'sunita@example.com',
        }),
        detail: {
          tags: TAGS,
          summary: 'Add a parent contact channel (SMS/email/calendar)',
          description:
            'Registers how a no-login dependent is reached. `destination` is encrypted at rest and never returned.',
          ...bearer,
          ...idParam,
          requestBody: bodyDoc(notificationTargetSchema),
          responses: {
            201: okDoc('Notification target created', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                profile_id: { type: 'string', format: 'uuid' },
                channel: { type: 'string', enum: ['sms', 'email', 'calendar'] },
                is_active: { type: 'boolean' },
                created_at: { type: 'string', format: 'date-time' },
              },
            }),
            ...ownershipErrors,
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          },
        },
      })

      .get('/:id/notifications', controller.getNotifications, {
        beforeHandle: permissionGuard('profiles:read'),
        detail: {
          tags: TAGS,
          summary: 'Parent notification history',
          description: 'The 50 most recent notification log entries for this profile.',
          ...bearer,
          ...idParam,
          responses: {
            200: okDoc('Notification log entries, newest first', {
              type: 'array',
              items: NOTIFICATION_LOG_SHAPE,
            }),
            ...ownershipErrors,
          },
        },
      })
  );
}
