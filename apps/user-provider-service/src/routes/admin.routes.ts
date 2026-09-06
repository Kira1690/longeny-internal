import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import type { AdminController } from '../controllers/admin.controller.js';
import {
  adminContentFlagResolveSchema,
  adminModerationSchema,
  adminProgramStatusSchema,
  adminProviderStatusSchema,
  adminReportExportSchema,
  adminSettingsUpdateSchema,
  adminSuspendProviderSchema,
  adminUserStatusSchema,
  adminVerifyProviderSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Admin'];

// ── Shared errors ────────────────────────────────────────────────────────────

const unauthorized = errorDoc('Missing, expired or revoked bearer token', 'UNAUTHORIZED');

/**
 * The whole `/admin` group sits behind requireRole(ADMIN, SUPER_ADMIN).
 *
 * Both roles, because super_admin holds everything an admin holds (see
 * docs/09-auth-permissions-and-profile-context.md) and onboarding.routes.ts
 * already guarded its admin surface with both. Listing only `admin` here gave
 * the same person a 403 on /admin/dashboard and a 200 on /admin/onboarding.
 */
const forbidden = errorDoc(
  'Token carries neither the `admin` nor the `super_admin` role — `Requires one of roles: admin, super_admin`',
  'FORBIDDEN',
);

const adminErrors: OpenApiFragment = { 401: unauthorized, 403: forbidden };

const validationError = errorDoc('Request body failed validation', 'VALIDATION_ERROR');

function notFound(resource: string): OpenApiFragment {
  return errorDoc(`No ${resource} exists with that id`, 'NOT_FOUND');
}

// ── Parameters ───────────────────────────────────────────────────────────────

function uuidPath(name: string, description: string): OpenApiFragment {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description,
  };
}

const pageParams: OpenApiFragment = [
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
    schema: { type: 'integer', minimum: 1, default: 20 },
    description: 'Rows per page',
  },
];

/**
 * Sorting is applied, and only over the whitelist each list route declares —
 * the column names below are the keys of the corresponding `*_SORT_COLUMNS` map
 * in admin.service.ts. Anything else answers 400 rather than being ignored, so a
 * misspelt sort control fails loudly instead of silently returning newest-first.
 */
function sortParams(sortable: string[]): OpenApiFragment {
  return [
    {
      name: 'sortBy',
      in: 'query',
      required: false,
      schema: { type: 'string', enum: sortable, default: 'created_at' },
      description: 'Column to sort by. Any other value answers 400 BAD_REQUEST.',
    },
    {
      name: 'sortOrder',
      in: 'query',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      description: 'Sort direction. Anything other than `asc` or `desc` answers 400 BAD_REQUEST.',
    },
  ];
}

const PROVIDER_SORTABLE = [
  'created_at',
  'updated_at',
  'business_name',
  'display_name',
  'status',
  'rating_avg',
  'review_count',
  'total_bookings',
];

const USER_SORTABLE = ['created_at', 'updated_at', 'email', 'first_name', 'last_name', 'status'];

const PROGRAM_SORTABLE = [
  'created_at',
  'updated_at',
  'title',
  'category',
  'price',
  'status',
  'current_participants',
];

/** Raised by the sort whitelist when `sortBy` or `sortOrder` is not recognised. */
const badSort = errorDoc('`sortBy` or `sortOrder` is not a recognised value', 'BAD_REQUEST');

const dateRangeParams: OpenApiFragment = [
  {
    name: 'startDate',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date-time' },
    description: 'Start of the window. Defaults to 30 days ago.',
  },
  {
    name: 'endDate',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date-time' },
    description: 'End of the window. Defaults to now.',
  },
];

// ── Response shapes ──────────────────────────────────────────────────────────

/** buildPaginationMeta() — admin lists carry hasNext/hasPrev. */
const PAGINATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
    hasNext: { type: 'boolean' },
    hasPrev: { type: 'boolean' },
  },
};

/** `{ success, data: [...], pagination }` — pagination sits beside data, not inside it. */
function pagedDoc(description: string, items: OpenApiFragment, example?: unknown): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items },
            pagination: PAGINATION_SHAPE,
          },
        },
        ...(example === undefined
          ? {}
          : {
              example: {
                success: true,
                data: [example],
                pagination: {
                  page: 1,
                  limit: 20,
                  total: 1,
                  totalPages: 1,
                  hasNext: false,
                  hasPrev: false,
                },
              },
            }),
      },
    },
  };
}

const PROVIDER_SHAPE: OpenApiFragment = {
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
  },
};

const VERIFICATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    document_type: { type: 'string', example: 'medical_license' },
    document_url: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    reviewer_id: { type: 'string', format: 'uuid', nullable: true },
    reviewed_at: { type: 'string', format: 'date-time', nullable: true },
    notes: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

/** A provider row enriched with its owner and verification documents. */
const PROVIDER_ROW_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    ...PROVIDER_SHAPE.properties,
    user: {
      type: 'object',
      nullable: true,
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'suspended', 'deactivated'],
          description: 'The owner account status — only present on /admin/providers',
        },
      },
    },
    verifications: { type: 'array', items: VERIFICATION_SHAPE },
  },
};

const PROVIDER_EXAMPLE = {
  id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  user_id: '3c2b1a09-8877-4d66-9e55-1f2e3d4c5b6a',
  business_name: 'Ridgeview Metabolic Health',
  display_name: 'Ridgeview',
  specialties: ['metabolic health'],
  credentials: ['MD'],
  hourly_rate: '180.00',
  currency: 'USD',
  offers_virtual: true,
  offers_in_person: false,
  status: 'pending',
  rating_avg: '0.00',
  review_count: 0,
  total_bookings: 0,
  cancellation_hours: 24,
};

/** The same provider as returned by the list routes, with owner + documents. */
const PROVIDER_ROW_EXAMPLE = {
  ...PROVIDER_EXAMPLE,
  user: {
    first_name: 'Anita',
    last_name: 'Rao',
    email: 'anita@ridgeview.example',
    status: 'active',
  },
  verifications: [],
};

/** The trimmed user projection used by the list route. */
const USER_LIST_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    auth_id: { type: 'string', format: 'uuid' },
    email: { type: 'string' },
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    avatar_url: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'deactivated'] },
    timezone: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    provider: {
      type: 'object',
      nullable: true,
      description: 'Null when the account is not a provider',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: {
          type: 'string',
          enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
        },
        business_name: { type: 'string' },
      },
    },
  },
};

const USER_EXAMPLE = {
  id: '4d5e6f70-8192-4a3b-9c4d-5e6f70819243',
  auth_id: '22222222-2222-2222-2222-222222222222',
  email: 'vishal@example.com',
  first_name: 'Vishal',
  last_name: 'Dafada',
  avatar_url: null,
  status: 'active',
  timezone: 'America/New_York',
  provider: null,
};

/**
 * The `users` row after sanitizeUser(): `phone_encrypted`,
 * `date_of_birth_encrypted` and `phone_hash` are stripped and replaced by
 * presence booleans. The ciphertext was useless to a client and the hash is a
 * keyed correlation key that must not leave the service.
 */
const USER_DETAIL_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    auth_id: { type: 'string', format: 'uuid' },
    email: { type: 'string' },
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    has_phone: {
      type: 'boolean',
      description: 'Whether a phone number is on file. The number itself is never returned.',
    },
    has_date_of_birth: {
      type: 'boolean',
      description: 'Whether a date of birth is on file. The date itself is never returned.',
    },
    avatar_url: { type: 'string', nullable: true },
    gender: {
      type: 'string',
      nullable: true,
      enum: ['male', 'female', 'non_binary', 'prefer_not_to_say'],
    },
    timezone: { type: 'string' },
    status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'deactivated'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const PROGRAM_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    short_description: { type: 'string', nullable: true },
    category: { type: 'string' },
    subcategory: { type: 'string', nullable: true },
    duration_weeks: { type: 'integer', nullable: true },
    session_count: { type: 'integer', nullable: true },
    session_duration_minutes: { type: 'integer' },
    price: { type: 'string' },
    price_type: { type: 'string', enum: ['one_time', 'per_session', 'subscription'] },
    max_participants: { type: 'integer', nullable: true },
    current_participants: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    image_url: { type: 'string', nullable: true },
    is_featured: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const PROGRAM_ROW_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    ...PROGRAM_SHAPE.properties,
    provider: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string', format: 'uuid' },
        business_name: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
        },
      },
    },
  },
};

const PROGRAM_EXAMPLE = {
  id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
  provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  title: '12-Week Metabolic Reset',
  description: 'Structured reversal programme with weekly clinician review.',
  category: 'metabolic',
  duration_weeks: 12,
  session_duration_minutes: 60,
  price: '1200.00',
  price_type: 'one_time',
  current_participants: 0,
  tags: ['diabetes'],
  is_featured: false,
  status: 'active',
};

/** The same program as returned by the list route, with its owning provider. */
const PROGRAM_ROW_EXAMPLE = {
  ...PROGRAM_EXAMPLE,
  provider: {
    id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
    business_name: 'Ridgeview Metabolic Health',
    status: 'verified',
  },
};

const MODERATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    entity_type: { type: 'string', example: 'program' },
    entity_id: { type: 'string', format: 'uuid' },
    reason: { type: 'string' },
    reported_by: { type: 'string', format: 'uuid', nullable: true },
    auto_flagged: { type: 'boolean' },
    auto_flag_source: { type: 'string', nullable: true },
    priority: { type: 'integer', description: 'Lower sorts first; default 5' },
    status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'escalated'] },
    assigned_to: { type: 'string', format: 'uuid', nullable: true },
    reviewed_by: { type: 'string', format: 'uuid', nullable: true },
    reviewed_at: { type: 'string', format: 'date-time', nullable: true },
    review_notes: { type: 'string', nullable: true },
    action_taken: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const MODERATION_EXAMPLE = {
  id: '6f7a8b9c-0d1e-4f20-8314-25364758697a',
  entity_type: 'program',
  entity_id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
  reason: 'Reported for unsupported medical claims',
  auto_flagged: false,
  priority: 3,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
};

const CONTENT_FLAG_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    entity_type: { type: 'string', example: 'review' },
    entity_id: { type: 'string', format: 'uuid' },
    flag_type: {
      type: 'string',
      enum: ['inappropriate', 'spam', 'fake', 'harmful', 'copyright', 'other'],
    },
    description: { type: 'string', nullable: true },
    reported_by: { type: 'string', format: 'uuid' },
    evidence_urls: { type: 'array', nullable: true, items: { type: 'string' } },
    status: { type: 'string', enum: ['open', 'reviewing', 'resolved', 'dismissed'] },
    resolved_by: { type: 'string', format: 'uuid', nullable: true },
    resolved_at: { type: 'string', format: 'date-time', nullable: true },
    resolution_notes: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    reporter: {
      type: 'object',
      nullable: true,
      description: 'Only present on the list route',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
};

const CONTENT_FLAG_EXAMPLE = {
  id: '8b9c0d1e-2f30-4415-8627-38495a6b7c8d',
  entity_type: 'review',
  entity_id: 'd1e2f304-1526-4738-894a-5b6c7d8e9f01',
  flag_type: 'spam',
  description: 'Repeated promotional link',
  reported_by: '4d5e6f70-8192-4a3b-9c4d-5e6f70819243',
  status: 'open',
  resolved_by: null,
  resolved_at: null,
};

/** The list route additionally joins in who reported it. */
const CONTENT_FLAG_ROW_EXAMPLE = {
  ...CONTENT_FLAG_EXAMPLE,
  reporter: { first_name: 'Vishal', last_name: 'Dafada', email: 'vishal@example.com' },
};

const ADMIN_ACTION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    admin_id: { type: 'string', format: 'uuid' },
    action_type: {
      type: 'string',
      enum: [
        'verify_provider',
        'suspend_provider',
        'reactivate_provider',
        'suspend_user',
        'reactivate_user',
        'delete_user',
        'moderate_content',
        'update_settings',
        'export_data',
        'approve_refund',
        'reject_refund',
      ],
    },
    target_type: { type: 'string', example: 'provider' },
    target_id: { type: 'string', format: 'uuid' },
    details: { type: 'object', nullable: true, additionalProperties: true },
    reason: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const SNAPSHOT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    metric_type: { type: 'string', example: 'user_signups' },
    metric_value: { type: 'string', description: 'Numeric, serialised as a string' },
    dimensions: { type: 'object', nullable: true, additionalProperties: true },
    period_start: { type: 'string', format: 'date-time' },
    period_end: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const SNAPSHOTS_ONLY_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: { snapshots: { type: 'array', items: SNAPSHOT_SHAPE } },
};

const SETTING_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    key: { type: 'string', example: 'marketplace.commission_pct' },
    value: {
      description: 'Arbitrary JSON. Replaced by the string `"***"` when `isSensitive` is true.',
    },
    category: { type: 'string', example: 'marketplace' },
    description: { type: 'string', nullable: true },
    isSensitive: { type: 'boolean' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const RAW_SETTING_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    value: { description: 'Arbitrary JSON — returned unmasked on write, even when sensitive' },
    category: { type: 'string' },
    description: { type: 'string', nullable: true },
    is_sensitive: { type: 'boolean' },
    updated_by: { type: 'string', format: 'uuid', nullable: true },
    updated_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const COUNT_SERIES_SHAPE: OpenApiFragment = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date' },
      count: { type: 'integer' },
    },
  },
};

export function createAdminRoutes(controller: AdminController) {
  return (
    new Elysia({ prefix: '/admin' })
      .use(requireAuth())
      .use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN))

      // ── Dashboard ──
      .get('/dashboard', controller.getDashboardOverview, {
        detail: {
          tags: TAGS,
          summary: 'Admin dashboard counters',
          description:
            'The single call behind the admin home screen: live counts of users (total, active, signed up today), providers (total, pending, verified), programs, products, the pending moderation backlog and open content flags. Every number is a `COUNT(*)` run at request time, so call it on page load or on a slow refresh — not in a poll.',
          ...bearer,
          responses: {
            200: okDoc(
              'Platform counters',
              {
                type: 'object',
                properties: {
                  users: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      active: { type: 'integer' },
                      newToday: { type: 'integer' },
                    },
                  },
                  providers: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      pending: { type: 'integer' },
                      verified: { type: 'integer' },
                    },
                  },
                  programs: { type: 'object', properties: { total: { type: 'integer' } } },
                  products: { type: 'object', properties: { total: { type: 'integer' } } },
                  moderation: { type: 'object', properties: { pending: { type: 'integer' } } },
                  contentFlags: { type: 'object', properties: { open: { type: 'integer' } } },
                },
              },
              {
                users: { total: 1284, active: 1190, newToday: 7 },
                providers: { total: 96, pending: 5, verified: 88 },
                programs: { total: 214 },
                products: { total: 87 },
                moderation: { pending: 3 },
                contentFlags: { open: 2 },
              },
            ),
            ...adminErrors,
          },
        },
      })

      // ── Provider management ──
      .get('/providers/pending', controller.getPendingProviders, {
        detail: {
          tags: TAGS,
          summary: 'List providers awaiting verification',
          description:
            'The verification work queue: providers stuck at status `pending`, **oldest first** so the queue drains fairly, each with the owner’s name and email and their still-pending verification documents. Approve one with `POST /admin/providers/{id}/verify`. Providers with no documents uploaded yet still appear here, with an empty `verifications` array.',
          ...bearer,
          parameters: pageParams,
          responses: {
            200: pagedDoc(
              'One page of pending providers',
              PROVIDER_ROW_SHAPE,
              PROVIDER_ROW_EXAMPLE,
            ),
            ...adminErrors,
          },
        },
      })
      .get('/providers', controller.listProviders, {
        detail: {
          tags: TAGS,
          summary: 'List all providers',
          description:
            'Every provider at any status, newest first, each with the owner account (name, email, account status) and their most recent verification document. Deactivated and rejected providers are included — this is the admin view, not the public directory.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
              },
              description: 'Restrict to one provider status',
            },
            {
              name: 'search',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Case-insensitive substring match on business name or display name',
            },
            ...pageParams,
            ...sortParams(PROVIDER_SORTABLE),
          ],
          responses: {
            200: pagedDoc('One page of providers', PROVIDER_ROW_SHAPE, PROVIDER_ROW_EXAMPLE),
            400: badSort,
            ...adminErrors,
          },
        },
      })
      .patch('/providers/:id/status', controller.updateProviderStatus, {
        body: documented(adminProviderStatusSchema),
        detail: {
          tags: TAGS,
          summary: 'Change a provider’s status',
          description:
            'The general status lever — use it to reinstate a suspended provider, reject an application, or deactivate an account. Any status in the enum is accepted from any current status; there is no state machine. The change and the previous status are written to the admin audit log in the same transaction, so a failed update leaves no audit row. `reason` is optional but is the only free-text explanation the audit log will carry.',
          ...bearer,
          parameters: [uuidPath('id', 'Provider id (`providers.id`)')],
          requestBody: bodyDoc(adminProviderStatusSchema),
          responses: {
            200: okDoc('The provider row after the change', PROVIDER_SHAPE, {
              ...PROVIDER_EXAMPLE,
              status: 'verified',
            }),
            400: validationError,
            ...adminErrors,
            404: notFound('provider'),
          },
        },
      })
      .post('/providers/:id/verify', controller.verifyProvider, {
        body: documented(adminVerifyProviderSchema),
        detail: {
          tags: TAGS,
          summary: 'Approve a provider’s verification documents',
          description:
            'Approves the listed verification documents and flips the provider to `verified` in one transaction. Omit `verificationIds` to approve **every** pending document for that provider, which is the normal case from the queue screen. `notes` is copied onto each approved document. The response is only `{ success: true }` — re-read the provider if you need the updated row.',
          ...bearer,
          parameters: [uuidPath('id', 'Provider id (`providers.id`)')],
          requestBody: bodyDoc(adminVerifyProviderSchema),
          responses: {
            200: okDoc(
              'Documents approved and provider verified',
              { type: 'object', properties: { success: { type: 'boolean', example: true } } },
              { success: true },
            ),
            400: validationError,
            ...adminErrors,
            404: notFound('provider'),
          },
        },
      })
      .put('/providers/:id/suspend', controller.suspendProvider, {
        body: documented(adminSuspendProviderSchema),
        detail: {
          tags: TAGS,
          summary: 'Suspend a provider',
          description:
            'Shorthand for setting status to `suspended`, with the reason recorded in the admin audit log. A suspended provider drops out of the public directory but keeps access to their own `/providers/me/*` routes. Reinstate through `PATCH /admin/providers/{id}/status`. `reason` is optional, so `{}` — or no body at all — is a valid suspension with nothing written to the audit entry’s free-text field.',
          ...bearer,
          parameters: [uuidPath('id', 'Provider id (`providers.id`)')],
          requestBody: bodyDoc(adminSuspendProviderSchema),
          responses: {
            200: okDoc('The provider row after suspension', PROVIDER_SHAPE, {
              ...PROVIDER_EXAMPLE,
              status: 'suspended',
            }),
            400: validationError,
            ...adminErrors,
            404: notFound('provider'),
          },
        },
      })

      // ── User management ──
      .get('/users', controller.listUsers, {
        detail: {
          tags: TAGS,
          summary: 'List user accounts',
          description:
            'All accounts, newest first, in a trimmed projection — no encrypted columns. Each row carries a `provider` block when that account is also a provider, so one list serves both "find a patient" and "find the account behind a provider". Use `GET /admin/users/{id}` for the full record.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['active', 'inactive', 'suspended', 'deactivated'],
              },
              description: 'Restrict to one account status',
            },
            {
              name: 'search',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Case-insensitive substring match on email, first name or last name',
            },
            ...pageParams,
            ...sortParams(USER_SORTABLE),
          ],
          responses: {
            200: pagedDoc('One page of accounts', USER_LIST_SHAPE, USER_EXAMPLE),
            400: badSort,
            ...adminErrors,
          },
        },
      })
      .get('/users/:id', controller.getUserDetail, {
        detail: {
          tags: TAGS,
          summary: 'Get one user account',
          description:
            'The `users` row for one account. Health data, profiles and progress are **not** included — this is the account record only. Phone and date of birth are never returned in any form: the stored ciphertext is not decrypted for admins and the `phone_hash` lookup digest never leaves the service, so the record carries `has_phone` / `has_date_of_birth` booleans instead.',
          ...bearer,
          parameters: [uuidPath('id', 'Internal `users.id` (not the auth id)')],
          responses: {
            200: okDoc('The account record', USER_DETAIL_SHAPE, {
              id: '4d5e6f70-8192-4a3b-9c4d-5e6f70819243',
              auth_id: '22222222-2222-2222-2222-222222222222',
              email: 'vishal@example.com',
              first_name: 'Vishal',
              last_name: 'Dafada',
              has_phone: true,
              has_date_of_birth: false,
              avatar_url: null,
              gender: null,
              timezone: 'America/New_York',
              status: 'active',
            }),
            ...adminErrors,
            404: notFound('user'),
          },
        },
      })
      .patch('/users/:id/status', controller.updateUserStatus, {
        body: documented(adminUserStatusSchema),
        detail: {
          tags: TAGS,
          summary: 'Change a user account’s status',
          description:
            'Suspends, reinstates or deactivates an account, recording the previous status and the reason in the admin audit log. This writes the status column here; it does not revoke the user’s outstanding access tokens on its own, so a suspended user may keep a valid token until it expires — treat suspension as effective from their next login, not instantly.',
          ...bearer,
          parameters: [uuidPath('id', 'Internal `users.id`')],
          requestBody: bodyDoc(adminUserStatusSchema),
          responses: {
            200: okDoc('The account row after the change', USER_DETAIL_SHAPE),
            400: validationError,
            ...adminErrors,
            404: notFound('user'),
          },
        },
      })

      // ── Program management ──
      .get('/programs', controller.listPrograms, {
        detail: {
          tags: TAGS,
          summary: 'List programs across all providers',
          description:
            'Every program on the platform at any status, newest first, each with a small block naming the owning provider. Drafts and archived programs are included — use `status` to build the moderation view you want.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'] },
              description: 'Restrict to one program status',
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact category match',
            },
            {
              name: 'search',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Case-insensitive substring match on title or description',
            },
            ...pageParams,
            ...sortParams(PROGRAM_SORTABLE),
          ],
          responses: {
            200: pagedDoc('One page of programs', PROGRAM_ROW_SHAPE, PROGRAM_ROW_EXAMPLE),
            400: badSort,
            ...adminErrors,
          },
        },
      })
      .patch('/programs/:id/status', controller.updateProgramStatus, {
        body: documented(adminProgramStatusSchema),
        detail: {
          tags: TAGS,
          summary: 'Change a program’s status',
          description:
            'Admin override of a listing’s lifecycle — pause a program that is under review, archive one that breaches policy, or restore it to `active`. Logged as a `moderate_content` action with the previous status and the reason. The provider is not notified by this call.',
          ...bearer,
          parameters: [uuidPath('id', 'Program id (`programs.id`)')],
          requestBody: bodyDoc(adminProgramStatusSchema),
          responses: {
            200: okDoc('The program row after the change', PROGRAM_SHAPE, {
              ...PROGRAM_EXAMPLE,
              status: 'paused',
            }),
            400: validationError,
            ...adminErrors,
            404: notFound('program'),
          },
        },
      })

      // ── Moderation ──
      .get('/moderation', controller.getModerationQueue, {
        detail: {
          tags: TAGS,
          summary: 'Get the moderation queue',
          description:
            'Items waiting on a human decision, ordered by `priority` ascending then oldest first — so priority 1 outranks priority 5 and ties break in favour of whatever has waited longest. Each row names the entity being moderated by `entity_type` + `entity_id`; the entity itself is not joined in, so fetch it separately if you need to show the content.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'approved', 'rejected', 'escalated'] },
              description: 'Restrict to one review status. Omit to see the whole queue.',
            },
            {
              name: 'entityType',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'program' },
              description: 'Restrict to one kind of entity',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc('One page of moderation items', MODERATION_SHAPE, MODERATION_EXAMPLE),
            ...adminErrors,
          },
        },
      })
      .patch('/moderation/:id', controller.moderateItem, {
        body: documented(adminModerationSchema),
        detail: {
          tags: TAGS,
          summary: 'Decide a moderation item',
          description:
            'Records the decision on one queue item: stamps the reviewing admin and the time, stores the notes, and writes a `moderate_content` entry to the admin audit log against the moderated entity. This only closes the queue item — it does **not** change the entity itself, so pair an `approved`/`rejected` decision with the matching status change on the program, provider or account.',
          ...bearer,
          parameters: [uuidPath('id', 'Moderation queue item id')],
          requestBody: bodyDoc(adminModerationSchema),
          responses: {
            200: okDoc('The queue item after the decision', MODERATION_SHAPE, {
              ...MODERATION_EXAMPLE,
              status: 'rejected',
              reviewed_by: '1a2b3c4d-5e6f-4708-8192-a3b4c5d6e7f8',
              reviewed_at: '2026-08-25T09:12:00.000Z',
              review_notes: 'Claim not supported by cited study',
              action_taken: 'program_paused',
            }),
            400: validationError,
            ...adminErrors,
            404: notFound('moderation queue item'),
          },
        },
      })

      // ── Analytics ──
      .get('/analytics/overview', controller.getAnalyticsOverview, {
        detail: {
          tags: TAGS,
          summary: 'Platform totals plus recent snapshots',
          description:
            'Live totals for users, providers, programs and products (with the active/verified split), plus the 10 most recent analytics snapshots of any metric type. Takes no date range — for a time series use one of the `/admin/analytics/*` routes below.',
          ...bearer,
          responses: {
            200: okDoc(
              'Totals and the latest snapshots',
              {
                type: 'object',
                properties: {
                  users: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      active: { type: 'integer' },
                    },
                  },
                  providers: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      verified: { type: 'integer' },
                    },
                  },
                  programs: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      active: { type: 'integer' },
                    },
                  },
                  products: { type: 'object', properties: { total: { type: 'integer' } } },
                  recentSnapshots: { type: 'array', items: SNAPSHOT_SHAPE },
                },
              },
              {
                users: { total: 1284, active: 1190 },
                providers: { total: 96, verified: 88 },
                programs: { total: 214, active: 180 },
                products: { total: 87 },
                recentSnapshots: [],
              },
            ),
            ...adminErrors,
          },
        },
      })
      .get('/analytics/users', controller.getUserAnalytics, {
        detail: {
          tags: TAGS,
          summary: 'User growth analytics',
          description:
            'Two series for the growth chart: pre-computed `user_*` snapshots inside the window, and `newUsers` — a live signup count grouped by calendar day, straight from the `users` table. `newUsers` is always daily; the `granularity` parameter is accepted but not applied, so roll the series up client-side if you need weeks or months.',
          ...bearer,
          parameters: [
            ...dateRangeParams,
            {
              name: 'granularity',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['day', 'week', 'month'] },
              description:
                'Accepted and parsed, but **not currently applied** — buckets are daily.',
            },
          ],
          responses: {
            200: okDoc(
              'Snapshots and the daily signup series',
              {
                type: 'object',
                properties: {
                  snapshots: { type: 'array', items: SNAPSHOT_SHAPE },
                  newUsers: COUNT_SERIES_SHAPE,
                },
              },
              { snapshots: [], newUsers: [{ date: '2026-08-24', count: 7 }] },
            ),
            ...adminErrors,
          },
        },
      })
      .get('/analytics/revenue', controller.getRevenueAnalytics, {
        detail: {
          tags: TAGS,
          summary: 'Revenue analytics',
          description:
            'Pre-computed `revenue_*` snapshots whose period falls inside the window, oldest first. This service does not hold payments — the numbers are whatever the analytics pipeline wrote into `analytics_snapshots`, so an empty array means nothing has been computed for that window, not that revenue was zero.',
          ...bearer,
          parameters: dateRangeParams,
          responses: {
            200: okDoc('Revenue snapshots in the window', SNAPSHOTS_ONLY_SHAPE, { snapshots: [] }),
            ...adminErrors,
          },
        },
      })
      .get('/analytics/bookings', controller.getBookingAnalytics, {
        detail: {
          tags: TAGS,
          summary: 'Booking analytics',
          description:
            'Pre-computed `booking_*` snapshots in the window, oldest first. Bookings live in the booking service; this endpoint reads only what the analytics pipeline has already snapshotted here.',
          ...bearer,
          parameters: dateRangeParams,
          responses: {
            200: okDoc('Booking snapshots in the window', SNAPSHOTS_ONLY_SHAPE, { snapshots: [] }),
            ...adminErrors,
          },
        },
      })
      .get('/analytics/ai', controller.getAiAnalytics, {
        detail: {
          tags: TAGS,
          summary: 'AI usage analytics',
          description:
            'Pre-computed `ai_*` snapshots in the window, oldest first — AI feature usage as recorded by the analytics pipeline. Read `metric_type` to tell the series apart.',
          ...bearer,
          parameters: dateRangeParams,
          responses: {
            200: okDoc('AI snapshots in the window', SNAPSHOTS_ONLY_SHAPE, { snapshots: [] }),
            ...adminErrors,
          },
        },
      })
      .get('/analytics/providers', controller.getProviderAnalytics, {
        detail: {
          tags: TAGS,
          summary: 'Provider growth analytics',
          description:
            'The provider-side twin of the user growth route: pre-computed `provider_*` snapshots plus `newProviders`, a live count of provider registrations grouped by calendar day.',
          ...bearer,
          parameters: dateRangeParams,
          responses: {
            200: okDoc(
              'Snapshots and the daily registration series',
              {
                type: 'object',
                properties: {
                  snapshots: { type: 'array', items: SNAPSHOT_SHAPE },
                  newProviders: COUNT_SERIES_SHAPE,
                },
              },
              { snapshots: [], newProviders: [{ date: '2026-08-24', count: 2 }] },
            ),
            ...adminErrors,
          },
        },
      })

      // ── Platform settings ──
      .get('/settings', controller.getSettings, {
        detail: {
          tags: TAGS,
          summary: 'Read platform settings',
          description:
            'Configuration rows grouped by category, in camelCase. Values marked `isSensitive` come back as the literal string `"***"` — the real value is never returned by this route, so do not round-trip a masked value back through `PUT /admin/settings` or you will overwrite the secret with `"***"`.',
          ...bearer,
          parameters: [
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'marketplace' },
              description: 'Restrict to one settings category. Omit for all.',
            },
          ],
          responses: {
            200: okDoc('Settings, ordered by category', { type: 'array', items: SETTING_SHAPE }, [
              {
                key: 'marketplace.commission_pct',
                value: 12,
                category: 'marketplace',
                description: 'Platform commission on marketplace sales',
                isSensitive: false,
                updatedAt: '2026-08-01T10:00:00.000Z',
              },
            ]),
            ...adminErrors,
          },
        },
      })
      .put('/settings', controller.updateSettings, {
        body: documented(adminSettingsUpdateSchema),
        detail: {
          tags: TAGS,
          summary: 'Update platform settings',
          description:
            'Upserts a batch of settings by key: an existing key is updated, an unknown key is **created** in category `general` rather than rejected, so a typo silently adds a new setting. One `update_settings` audit entry is written for the whole batch, listing the keys. The response is the raw stored rows in snake_case — and sensitive values are returned unmasked here, unlike on the read route. `settings` must be a non-empty list: an absent or empty one answers 400 rather than writing an audit row for a no-op.',
          ...bearer,
          requestBody: bodyDoc(adminSettingsUpdateSchema),
          responses: {
            200: okDoc('The stored rows after the upsert', {
              type: 'array',
              items: RAW_SETTING_SHAPE,
            }),
            400: validationError,
            ...adminErrors,
          },
        },
      })

      // ── Reports ──
      .post('/reports/export', controller.exportReport, {
        body: documented(adminReportExportSchema),
        detail: {
          tags: TAGS,
          summary: 'Export a report',
          description:
            'Returns the report rows **inline in the response body** — this does not produce a file or a download link, and `format` is echoed back rather than applied, so a CSV is something the client renders from the JSON. `reportType` must be one of `users`, `providers` or `programs`; anything else is rejected by the request schema with `400 VALIDATION_ERROR`. Rows are filtered by `created_at` inside the window, which defaults to the last 30 days. The export itself is logged as an `export_data` admin action. Large windows return large payloads — there is no pagination on this route.',
          ...bearer,
          requestBody: bodyDoc(adminReportExportSchema),
          responses: {
            200: okDoc(
              'The report rows, with the requested type and format echoed back',
              {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                    description: 'Shape depends on `reportType`',
                  },
                  format: { type: 'string' },
                  reportType: { type: 'string', enum: ['users', 'providers', 'programs'] },
                },
              },
              {
                data: [
                  {
                    id: '4d5e6f70-8192-4a3b-9c4d-5e6f70819243',
                    email: 'vishal@example.com',
                    first_name: 'Vishal',
                    last_name: 'Dafada',
                    status: 'active',
                    created_at: '2026-07-14T08:31:00.000Z',
                  },
                ],
                format: 'csv',
                reportType: 'users',
              },
            ),
            400: validationError,
            ...adminErrors,
          },
        },
      })

      // ── Content flags ──
      .get('/content-flags', controller.listContentFlags, {
        detail: {
          tags: TAGS,
          summary: 'List content flags',
          description:
            'User-submitted reports about content — spam, fake listings, harmful claims — newest first, each with the reporter’s name and email. Distinct from the moderation queue: flags are what users raised, the queue is what the platform decided to review. Filter on `status: open` for the unhandled ones.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['open', 'reviewing', 'resolved', 'dismissed'] },
              description: 'Restrict to one flag status',
            },
            {
              name: 'entityType',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'review' },
              description: 'Restrict to flags raised against one kind of entity',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc(
              'One page of content flags',
              CONTENT_FLAG_SHAPE,
              CONTENT_FLAG_ROW_EXAMPLE,
            ),
            ...adminErrors,
          },
        },
      })
      .put('/content-flags/:id', controller.resolveContentFlag, {
        body: documented(adminContentFlagResolveSchema),
        detail: {
          tags: TAGS,
          summary: 'Resolve a content flag',
          description:
            'Closes one flag: stamps the resolving admin and time, stores the notes, and writes a `moderate_content` audit entry against the flagged entity. Use `resolved` when you acted on the report and `dismissed` when you did not. Like the moderation queue, this closes the report only — it does not change the flagged content.',
          ...bearer,
          parameters: [uuidPath('id', 'Content flag id (`content_flags.id`)')],
          requestBody: bodyDoc(adminContentFlagResolveSchema),
          responses: {
            200: okDoc('The flag row after resolution', CONTENT_FLAG_SHAPE, {
              ...CONTENT_FLAG_EXAMPLE,
              status: 'resolved',
              resolved_by: '1a2b3c4d-5e6f-4708-8192-a3b4c5d6e7f8',
              resolved_at: '2026-08-25T09:20:00.000Z',
              resolution_notes: 'Review removed by the author',
            }),
            400: validationError,
            ...adminErrors,
            404: notFound('content flag'),
          },
        },
      })

      // ── Audit log ──
      .get('/audit-logs', controller.getAuditLogs, {
        detail: {
          tags: TAGS,
          summary: 'Read the admin audit log',
          description:
            'Every privileged action taken through the admin routes — verifications, suspensions, moderation decisions, settings changes, exports — newest first. `details` carries the action-specific payload (previous and new status, approved document ids, changed setting keys). This is the record of what admins did; patient health-data access is audited separately in `phi_access_log` and is not exposed here.',
          ...bearer,
          parameters: [
            {
              name: 'adminId',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
              description: 'Only actions taken by this admin',
            },
            {
              name: 'actionType',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: [
                  'verify_provider',
                  'suspend_provider',
                  'reactivate_provider',
                  'suspend_user',
                  'reactivate_user',
                  'delete_user',
                  'moderate_content',
                  'update_settings',
                  'export_data',
                  'approve_refund',
                  'reject_refund',
                ],
              },
              description: 'Only actions of this type',
            },
            {
              name: 'targetType',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'provider' },
              description: 'Only actions against this kind of target',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc('One page of audit entries', ADMIN_ACTION_SHAPE, {
              id: 'c3d4e5f6-0718-4293-8a4b-5c6d7e8f9012',
              admin_id: '1a2b3c4d-5e6f-4708-8192-a3b4c5d6e7f8',
              action_type: 'suspend_provider',
              target_type: 'provider',
              target_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
              details: { previousStatus: 'verified', newStatus: 'suspended' },
              reason: 'Unresolved complaints from three patients',
              created_at: '2026-08-25T09:05:00.000Z',
            }),
            ...adminErrors,
          },
        },
      })
  );
}
