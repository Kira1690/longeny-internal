import { verifyHmac } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { InternalController } from '../controllers/internal.controller.js';
import type { ProfileController } from '../controllers/profile.controller.js';
import {
  notifyProfileSchema,
  resolveProfileSchema,
  rroTransitionSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const TAGS = ['Internal'];

/**
 * Internal routes are called service-to-service and authenticate with HMAC
 * headers, not a JWT. They are documented so backend/AI engineers can see the
 * contract, but they are not reachable from the browser (the gateway does not
 * proxy /internal/*).
 */
const hmacAuth: OpenApiFragment = {
  parameters: [
    {
      name: 'X-Service-Name',
      in: 'header',
      required: true,
      schema: { type: 'string', example: 'ai-content-service' },
      description: 'Calling service identifier',
    },
    {
      name: 'X-Timestamp',
      in: 'header',
      required: true,
      schema: { type: 'string', example: '1787308893341' },
      description:
        'Unix epoch milliseconds — must be within 30s of server time (replay protection)',
    },
    {
      name: 'X-Signature',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description:
        'HMAC-SHA256(secret, "METHOD\\nPATH\\nTIMESTAMP\\nSHA256(body)") over the exact raw body',
    },
  ],
};

/**
 * Prefix every description with the same warning: these are not browser routes.
 * Repeated per operation because Swagger UI shows one operation at a time.
 */
const S2S = 'Service-to-service only — HMAC-signed, never proxied by the gateway.';

const hmacErrors: OpenApiFragment = {
  401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
  404: errorDoc('Profile not found', 'NOT_FOUND'),
};

const hmacUserErrors: OpenApiFragment = {
  401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
  404: errorDoc('No user exists with that id', 'NOT_FOUND'),
};

const hmacProviderErrors: OpenApiFragment = {
  401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
  404: errorDoc('No provider exists with that id', 'NOT_FOUND'),
};

// ── Path/query parameter fragments ───────────────────────────────────────────

function pathParam(name: string, description: string): OpenApiFragment {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description,
  };
}

const userIdParam = pathParam('id', 'Internal `users.id` (not the auth id)');
const providerIdParam = pathParam('id', 'Provider id (`providers.id`)');

const syncPagination: OpenApiFragment = [
  {
    name: 'page',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: '1-based page number',
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 50 },
    description: 'Rows per page. Defaults to 50 for sync callers (not 20).',
  },
];

// ── Response shapes ──────────────────────────────────────────────────────────

/** `{ total, page, limit, totalPages }` — this list does not carry hasNext/hasPrev. */
const SYNC_PAGINATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

/** A `users` row with the encrypted columns stripped and decrypted copies added. */
const INTERNAL_USER_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    auth_id: { type: 'string', format: 'uuid', description: 'The JWT `sub` for this account' },
    email: { type: 'string' },
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    avatar_url: { type: 'string', nullable: true },
    gender: {
      type: 'string',
      nullable: true,
      enum: ['male', 'female', 'non_binary', 'prefer_not_to_say'],
    },
    timezone: { type: 'string', example: 'America/New_York' },
    status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'deactivated'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    phone: {
      type: 'string',
      nullable: true,
      description: 'Decrypted for trusted callers. Absent when the account stored no phone.',
    },
    dateOfBirth: {
      type: 'string',
      nullable: true,
      description: 'Decrypted for trusted callers. Absent when the account stored no DOB.',
    },
    profile: {
      type: 'object',
      nullable: true,
      description: '`user_profiles` row — bio, country, goals, dietary prefs, fitness level',
      properties: {
        id: { type: 'string', format: 'uuid' },
        user_id: { type: 'string', format: 'uuid' },
        bio: { type: 'string', nullable: true },
        country: { type: 'string', example: 'US' },
        health_goals: { type: 'array', items: { type: 'string' } },
        dietary_preferences: { type: 'array', items: { type: 'string' } },
        fitness_level: { type: 'string', nullable: true },
        wellness_interests: { type: 'array', items: { type: 'string' } },
        preferred_session_type: { type: 'string', nullable: true },
      },
    },
    preferences: {
      type: 'object',
      nullable: true,
      description: '`user_preferences` row',
      properties: {
        notification_email: { type: 'boolean' },
        notification_sms: { type: 'boolean' },
        notification_push: { type: 'boolean' },
        language: { type: 'string', example: 'en' },
        theme: { type: 'string', example: 'light' },
        newsletter: { type: 'boolean' },
        booking_reminders_hours: { type: 'integer' },
      },
    },
  },
};

const HEALTH_PROFILE_SHAPE: OpenApiFragment = {
  type: 'object',
  nullable: true,
  description:
    'Null when the account has no health profile row. Encrypted fields are not included.',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    heightCm: { type: 'string', nullable: true, description: 'Numeric, serialised as a string' },
    weightKg: { type: 'string', nullable: true, description: 'Numeric, serialised as a string' },
    bloodType: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
    consentHealthSharing: { type: 'boolean' },
    consentAiAnalysis: { type: 'boolean' },
    lastCheckupDate: { type: 'string', format: 'date', nullable: true },
  },
};

/** The flat shape bravelabs-agent's provider-sync consumes. */
const PROVIDER_SYNC_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    provider_id: { type: 'string', format: 'uuid' },
    business_name: { type: 'string' },
    specialties: { type: 'array', items: { type: 'string' } },
    bio: { type: 'string', description: 'Empty string when unset, never null' },
    offers_virtual: { type: 'boolean' },
    offers_in_person: { type: 'boolean' },
    city: { type: 'string', description: 'Flattened from `location.city`; "" when unset' },
    years_experience: { type: 'integer' },
    hourly_rate: { type: 'number' },
    rating: { type: 'number' },
    is_active: { type: 'boolean', description: 'True only when provider status is `verified`' },
  },
};

const PROVIDER_SYNC_EXAMPLE = {
  provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  business_name: 'Ridgeview Metabolic Health',
  specialties: ['metabolic health', 'nutrition'],
  bio: 'Reversal-first metabolic clinic.',
  offers_virtual: true,
  offers_in_person: false,
  city: 'Austin',
  years_experience: 12,
  hourly_rate: 180,
  rating: 4.7,
  is_active: true,
};

/** Full `providers` row plus the owning user's name/email. */
const INTERNAL_PROVIDER_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    business_name: { type: 'string' },
    display_name: { type: 'string', nullable: true },
    bio: { type: 'string', nullable: true },
    specialties: { type: 'array', items: { type: 'string' } },
    credentials: { type: 'array', items: { type: 'string' } },
    years_experience: { type: 'integer', nullable: true },
    hourly_rate: { type: 'string', nullable: true, description: 'Numeric, serialised as a string' },
    currency: { type: 'string', example: 'USD' },
    location: { type: 'object', nullable: true, additionalProperties: true },
    service_area_radius_miles: { type: 'integer', nullable: true },
    offers_virtual: { type: 'boolean' },
    offers_in_person: { type: 'boolean' },
    status: {
      type: 'string',
      enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
    },
    rating_avg: { type: 'string' },
    review_count: { type: 'integer' },
    total_bookings: { type: 'integer' },
    website_url: { type: 'string', nullable: true },
    social_links: { type: 'object', nullable: true, additionalProperties: true },
    cancellation_policy: { type: 'string', nullable: true },
    cancellation_hours: { type: 'integer' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    user: {
      type: 'object',
      nullable: true,
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
};

const SLOT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    startTime: { type: 'string', example: '09:00', description: 'HH:mm, provider-local' },
    endTime: { type: 'string', example: '10:00' },
    available: { type: 'boolean', description: 'False when an override blocks the slot' },
  },
};

/** The GDPR export bundle — every table that holds this account's data. */
const GDPR_EXPORT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      description: 'Raw `users` row, encrypted columns included as ciphertext',
      additionalProperties: true,
    },
    profile: { type: 'object', nullable: true, additionalProperties: true },
    healthProfile: { type: 'object', nullable: true, additionalProperties: true },
    preferences: { type: 'object', nullable: true, additionalProperties: true },
    onboardingStates: {
      type: 'array',
      description: 'One row per profile under the account, not one per account',
      items: { type: 'object', additionalProperties: true },
    },
    progressEntries: { type: 'array', items: { type: 'object', additionalProperties: true } },
    habits: { type: 'array', items: { type: 'object', additionalProperties: true } },
    goals: { type: 'array', items: { type: 'object', additionalProperties: true } },
    achievements: { type: 'array', items: { type: 'object', additionalProperties: true } },
    reviews: { type: 'array', items: { type: 'object', additionalProperties: true } },
    savedItems: { type: 'array', items: { type: 'object', additionalProperties: true } },
    profiles: {
      type: 'array',
      description: 'Family/dependent profiles, with decrypted phone and DOB',
      items: { type: 'object', additionalProperties: true },
    },
    caregiverConsents: { type: 'array', items: { type: 'object', additionalProperties: true } },
    rroStates: { type: 'array', items: { type: 'object', additionalProperties: true } },
    rroTransitions: { type: 'array', items: { type: 'object', additionalProperties: true } },
    notificationTargets: { type: 'array', items: { type: 'object', additionalProperties: true } },
    notificationLog: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

const SUCCESS_FLAG_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: { success: { type: 'boolean', example: true } },
};

export function createInternalRoutes(controller: InternalController, profile: ProfileController) {
  return (
    new Elysia({ prefix: '/internal' })
      .use(verifyHmac(config.HMAC_SECRET))
      .get('/users/by-auth/:authId', controller.getUserByAuthId, {
        detail: {
          tags: TAGS,
          summary: 'Get a user by auth id',
          description: `${S2S} Resolves the JWT \`sub\` another service is holding into this service's user record, including the linked \`user_profiles\`, \`user_preferences\`, decrypted health profile and the account owner's own onboarding intake. Use this when all you have is the token subject; use \`GET /internal/users/{id}\` when you already hold the internal \`users.id\`.`,
          parameters: [
            ...hmacAuth.parameters,
            pathParam('authId', 'The auth service user id — the JWT `sub`'),
          ],
          responses: {
            200: okDoc('The user record with profile, preferences, health and onboarding', {
              ...INTERNAL_USER_SHAPE,
              properties: {
                ...INTERNAL_USER_SHAPE.properties,
                healthProfile: { type: 'object', nullable: true, additionalProperties: true },
                onboarding: {
                  type: 'object',
                  nullable: true,
                  description: "The account owner's own intake, decrypted",
                  additionalProperties: true,
                },
              },
            }),
            ...hmacUserErrors,
          },
        },
      })
      .get('/users/:id', controller.getUserById, {
        detail: {
          tags: TAGS,
          summary: 'Get a user by id',
          description: `${S2S} Reads a user by internal \`users.id\` and returns the account record with its \`user_profiles\` and \`user_preferences\` rows attached. Phone and date of birth are decrypted here — they are never returned on the public \`/users\` surface.`,
          parameters: [...hmacAuth.parameters, userIdParam],
          responses: {
            200: okDoc('The user record with profile and preferences', INTERNAL_USER_SHAPE),
            ...hmacUserErrors,
          },
        },
      })
      .get('/users/:id/health-profile', controller.getUserHealthProfile, {
        detail: {
          tags: TAGS,
          summary: 'Get a user health profile',
          description: `${S2S} Returns the non-sensitive slice of the health profile — height, weight, blood type, notes, consent flags and last checkup date. The encrypted columns (allergies, conditions, medications, emergency contact) are deliberately **not** included, so this is safe to hand to the AI services. Answers \`200\` with \`data: null\` when the user has no health profile row, not \`404\`.`,
          parameters: [...hmacAuth.parameters, userIdParam],
          responses: {
            200: okDoc('Sanitised health profile, or null when none exists', HEALTH_PROFILE_SHAPE),
            401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
          },
        },
      })
      .get('/providers', controller.listProvidersForSync, {
        detail: {
          tags: TAGS,
          summary: 'List providers for sync',
          description: `${S2S} Paginated list of **verified** providers only, in the flat shape bravelabs-agent's provider-sync upserts into the vector store. Pending, suspended, rejected and deactivated providers are excluded, so a provider disappearing from this feed means it lost verification. Page through until \`pagination.page === pagination.totalPages\`.`,
          parameters: [...hmacAuth.parameters, ...syncPagination],
          responses: {
            200: {
              description: 'One page of verified providers in agent-sync shape',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { type: 'array', items: PROVIDER_SYNC_SHAPE },
                      pagination: SYNC_PAGINATION_SHAPE,
                    },
                  },
                  example: {
                    success: true,
                    data: [PROVIDER_SYNC_EXAMPLE],
                    pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
                  },
                },
              },
            },
            401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
          },
        },
      })
      .get('/providers/:id', controller.getProviderById, {
        detail: {
          tags: TAGS,
          summary: 'Get a provider by id',
          description: `${S2S} The full \`providers\` row — every column, whatever the status — plus the owning user's name and email. Unlike the public \`GET /providers/{id}\`, this does not hide deactivated providers and does not attach programs or products.`,
          parameters: [...hmacAuth.parameters, providerIdParam],
          responses: {
            200: okDoc('The provider record with its owning user', INTERNAL_PROVIDER_SHAPE),
            ...hmacProviderErrors,
          },
        },
      })
      .get('/providers/:id/full', controller.getProviderForSync, {
        detail: {
          tags: TAGS,
          summary: 'Get full provider record for sync',
          description: `${S2S} One provider in the same flat agent-sync shape as \`GET /internal/providers\`, for re-indexing a single provider after an update event. "Full" means the sync projection, not every column — use \`GET /internal/providers/{id}\` for the raw row. Any provider id resolves here regardless of status; read \`is_active\` to decide whether to keep it indexed.`,
          parameters: [...hmacAuth.parameters, providerIdParam],
          responses: {
            200: okDoc('Provider in agent-sync shape', PROVIDER_SYNC_SHAPE, PROVIDER_SYNC_EXAMPLE),
            ...hmacProviderErrors,
          },
        },
      })
      .get('/providers/:id/availability', controller.getProviderAvailability, {
        detail: {
          tags: TAGS,
          summary: 'Get provider availability',
          description: `${S2S} Expands the provider's weekly availability rules into concrete slots for one date, honouring same-day overrides. Returns an empty array when the whole day is blocked or no rule covers that weekday. \`date\` defaults to today (UTC) when omitted. These are schedule slots only — this service does not know about bookings, so \`available\` reflects overrides, not existing appointments.`,
          parameters: [
            ...hmacAuth.parameters,
            providerIdParam,
            {
              name: 'date',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date', example: '2026-09-01' },
              description: 'YYYY-MM-DD. Defaults to today in UTC.',
            },
          ],
          responses: {
            200: okDoc('Slots for the requested date', { type: 'array', items: SLOT_SHAPE }, [
              { startTime: '09:00', endTime: '10:00', available: true },
              { startTime: '10:15', endTime: '11:15', available: false },
            ]),
            401: errorDoc('Missing, expired, or invalid HMAC signature', 'UNAUTHORIZED'),
          },
        },
      })
      .get('/gdpr/user-data/:userId', controller.getGdprUserData, {
        detail: {
          tags: TAGS,
          summary: 'Export all user data (GDPR)',
          description: `${S2S} Everything this service holds for one account, for a subject access request: the account row, profile, health profile, preferences, every profile's onboarding intake, progress entries, habits, goals, achievements, reviews, saved items, and the whole multi-profile/RRO set (dependent profiles, consents, RRO state and transitions, notification targets and log). Encrypted columns on the raw \`user\` row come back as ciphertext; the profile-scoped section decrypts phone and DOB for export.`,
          parameters: [
            ...hmacAuth.parameters,
            pathParam('userId', 'Internal `users.id` of the account being exported'),
          ],
          responses: {
            200: okDoc('Complete data bundle for the account', GDPR_EXPORT_SHAPE),
            ...hmacUserErrors,
          },
        },
      })
      .delete('/gdpr/user-data/:userId', controller.deleteGdprUserData, {
        detail: {
          tags: TAGS,
          summary: 'Erase all user data (GDPR)',
          description: `${S2S} **Irreversible.** Anonymises the \`users\` row (email becomes \`deleted_<id>@erased.longeny.com\`, name becomes "Deleted User", status becomes \`deactivated\`) and deletes every account-scoped and profile-scoped row beneath it, dependent profiles included. Two things are kept on purpose and cannot be deleted here: \`phi_access_log\` and \`caregiver_consent_audit\` — both are append-only in the database and are the evidence that the erasure was lawful. The \`users\` row itself is anonymised rather than dropped because bookings and payments still reference it.`,
          parameters: [
            ...hmacAuth.parameters,
            pathParam('userId', 'Internal `users.id` of the account being erased'),
          ],
          responses: {
            200: okDoc('Erasure completed', SUCCESS_FLAG_SHAPE, { success: true }),
            ...hmacUserErrors,
          },
        },
      })

      // ── Multi-profile / RRO (trusted service callers) ──
      .post('/profiles/resolve', profile.resolveProfile, {
        body: documented(resolveProfileSchema),
        detail: {
          tags: TAGS,
          summary: 'Resolve which profile an account may act as',
          description: `${S2S} Answers the ownership question for services that hold profile-scoped data in their own database and cannot join to \`profiles\`. Pass the \`sub\` from the JWT the caller authenticated and the profile it is asking to act as; omit \`profileId\` to get the account owner's own \`self\` profile, which is what a request carrying no \`X-Active-Profile-Id\` header means. A profile belonging to a different account answers **404**, exactly like one that does not exist — never 403, which would confirm the profile is real. The reply carries no PII.`,
          ...hmacAuth,
          requestBody: bodyDoc(resolveProfileSchema),
          responses: {
            200: okDoc(
              'Profile resolved — the account may act as it',
              {
                type: 'object',
                properties: {
                  profileId: { type: 'string', format: 'uuid' },
                  accountUserId: { type: 'string', format: 'uuid' },
                  relation: {
                    type: 'string',
                    enum: ['self', 'father', 'mother', 'spouse', 'child', 'sibling', 'other'],
                  },
                  isSelf: { type: 'boolean' },
                  status: { type: 'string', enum: ['active', 'inactive'] },
                },
              },
              {
                profileId: 'df864dbd-4eb5-4785-8299-28bb09a69246',
                accountUserId: '0f0e6f8a-6d1a-4f0b-9a7f-2f1b0a1c9d34',
                relation: 'father',
                isSelf: false,
                status: 'active',
              },
            ),
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
            ...hmacErrors,
          },
        },
      })
      .get('/profiles/:profileId/rro-state', profile.getRroStateForService, {
        detail: {
          tags: TAGS,
          summary: 'Read a profile’s RRO state and transition history',
          description: `${S2S} Returns the profile's current state, its goal and up to 50 transitions oldest-first. The AI classifier reads this before classifying so it can see a regression; it holds no user token, so it cannot use the account-scoped \`GET /profiles/{id}/rro-state\`. Ownership was established by whichever request triggered the classification.`,
          ...hmacAuth,
          responses: {
            200: okDoc(
              'Current state and history',
              {
                type: 'object',
                properties: {
                  profileId: { type: 'string', format: 'uuid' },
                  currentState: {
                    type: 'string',
                    nullable: true,
                    enum: ['intake', 'reverse', 'restore', 'optimise'],
                  },
                  goal: { type: 'string', nullable: true },
                  enteredAt: { type: 'string', format: 'date-time', nullable: true },
                  history: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        state: {
                          type: 'string',
                          enum: ['intake', 'reverse', 'restore', 'optimise'],
                        },
                        enteredAt: { type: 'string', format: 'date-time' },
                        source: { type: 'string' },
                      },
                    },
                  },
                },
              },
              {
                profileId: 'df864dbd-4eb5-4785-8299-28bb09a69246',
                currentState: 'intake',
                goal: null,
                enteredAt: '2026-08-27T09:00:00.000Z',
                history: [
                  { state: 'intake', enteredAt: '2026-08-27T09:00:00.000Z', source: 'system' },
                ],
              },
            ),
            ...hmacErrors,
          },
        },
      })
      .post('/rro-state/transition', profile.recordTransition, {
        body: documented(rroTransitionSchema),
        detail: {
          tags: TAGS,
          summary: 'Record an RRO state transition',
          description:
            'Moves a profile to a new RRO state and appends to its transition history. Called by the AI RRO classifier (`source: ai_classifier`) or by a clinician action (`source: clinician`).',
          ...hmacAuth,
          requestBody: bodyDoc(rroTransitionSchema),
          responses: {
            200: okDoc(
              'Transition recorded',
              {
                type: 'object',
                properties: {
                  profileId: { type: 'string', format: 'uuid' },
                  fromState: {
                    type: 'string',
                    nullable: true,
                    enum: ['intake', 'reverse', 'restore', 'optimise'],
                  },
                  toState: { type: 'string', enum: ['intake', 'reverse', 'restore', 'optimise'] },
                  transitionId: { type: 'string', format: 'uuid' },
                },
              },
              {
                profileId: 'df864dbd-4eb5-4785-8299-28bb09a69246',
                fromState: 'intake',
                toState: 'reverse',
                transitionId: '301a33f8-e890-4e29-a418-be8c691c17c1',
              },
            ),
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
            422: errorDoc(
              'The taxonomy does not permit this move — care advances, holds, or falls back one step, and cannot skip (e.g. intake → optimise)',
              'INVALID_TRANSITION',
            ),
            ...hmacErrors,
          },
        },
      })
      .post('/notify/profile', profile.notifyProfile, {
        body: documented(notifyProfileSchema),
        detail: {
          tags: TAGS,
          summary: 'Send a notification to a no-login (parent) profile',
          description:
            'Fans out to the profile’s active notification targets — all channels if `channel` is omitted — and **delivers**, then records the outcome in the notification log.\n\n`email` and `calendar` are sent over SMTP and the log row moves to `sent`, or to `failed` with the reason. `sms` has no transport yet and is recorded `failed` with that reason rather than `queued`: a queued row promises that something will send it, and nothing would.\n\n`delivered` counts what actually went out; `attempted` counts the targets tried. If no active target matches, returns `delivered: 0` with one logged `failed` entry. Pass `attachment` to carry an ICS invite — that is how `POST /bookings/calendar/invite` reaches a dependent.',
          ...hmacAuth,
          requestBody: bodyDoc(notifyProfileSchema),
          responses: {
            200: okDoc(
              'Notification queued for each matching target',
              {
                type: 'object',
                properties: {
                  profileId: { type: 'string', format: 'uuid' },
                  delivered: {
                    type: 'integer',
                    description: 'Targets the message actually reached',
                  },
                  attempted: { type: 'integer', description: 'Targets tried' },
                  entries: { type: 'array', items: { type: 'object' } },
                },
              },
              {
                profileId: 'df864dbd-4eb5-4785-8299-28bb09a69246',
                delivered: 1,
                attempted: 1,
                entries: [{ channel: 'email', subject: 'Check-in', status: 'sent' }],
              },
            ),
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
            ...hmacErrors,
          },
        },
      })
  );
}
