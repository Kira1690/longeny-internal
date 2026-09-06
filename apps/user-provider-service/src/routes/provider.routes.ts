import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import type { ProviderController } from '../controllers/provider.controller.js';
import {
  availabilityOverrideSchema,
  productSchema,
  programSchema,
  providerRegisterSchema,
  slotsQuerySchema,
  updateProviderProfileSchema,
  verificationDocumentSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const PUBLIC_TAGS = ['Providers'];
const OWN_TAGS = ['Provider Management'];

// ── Shared error responses ───────────────────────────────────────────────────

const unauthorized = errorDoc('Missing, expired or revoked bearer token', 'UNAUTHORIZED');

/** Every `/providers/me/*` route sits behind requireRole(PROVIDER). */
const providerRoleForbidden = errorDoc(
  'Token does not carry the `provider` role — `Requires one of roles: provider`',
  'FORBIDDEN',
);

/** getProviderByAuthId() throws before the handler runs when the caller has no provider row. */
const noProviderProfile = errorDoc(
  'No provider profile exists for this account (or the account itself is missing)',
  'NOT_FOUND',
);

const ownProviderErrors: OpenApiFragment = {
  401: unauthorized,
  403: providerRoleForbidden,
  404: noProviderProfile,
};

const validationError = errorDoc('Request body failed validation', 'VALIDATION_ERROR');

/**
 * Public browse routes take no id and no body, so they have no domain-level
 * failure: the only thing a client can see other than 200 is a server error.
 * Documented explicitly so nobody codes a 401/404 branch that can never fire.
 */
const publicServerError = errorDoc(
  'Unexpected server error. This route is unauthenticated and takes no resource id, so 200 and 500 are the only outcomes.',
  'INTERNAL_ERROR',
);

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

const providerIdParam = uuidPath('id', 'Provider id (`providers.id`)');

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

// ── Response shapes ──────────────────────────────────────────────────────────

/** Provider-module pagination: no hasNext/hasPrev on this surface. */
const PAGINATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

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
                pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
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
    location: {
      type: 'object',
      nullable: true,
      description:
        'Free-form JSON — `{ city, state, lat, lng }` when set through PUT /providers/me',
      additionalProperties: true,
    },
    service_area_radius_miles: { type: 'integer', nullable: true },
    offers_virtual: { type: 'boolean' },
    offers_in_person: { type: 'boolean' },
    status: {
      type: 'string',
      enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
    },
    rating_avg: { type: 'string', description: 'Numeric, serialised as a string' },
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

const PROVIDER_EXAMPLE = {
  id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  user_id: '3c2b1a09-8877-4d66-9e55-1f2e3d4c5b6a',
  business_name: 'Ridgeview Metabolic Health',
  display_name: 'Ridgeview',
  bio: 'Reversal-first metabolic clinic.',
  specialties: ['metabolic health', 'nutrition'],
  credentials: ['MD', 'ABOM'],
  years_experience: 12,
  hourly_rate: '180.00',
  currency: 'USD',
  location: { city: 'Austin', state: 'TX' },
  offers_virtual: true,
  offers_in_person: false,
  status: 'verified',
  rating_avg: '4.70',
  review_count: 31,
  total_bookings: 208,
  cancellation_hours: 24,
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
    session_count: {
      type: 'integer',
      nullable: true,
      description: 'Derived on create as durationWeeks × sessionsPerWeek',
    },
    session_duration_minutes: { type: 'integer' },
    price: { type: 'string', description: 'Numeric, serialised as a string' },
    price_type: { type: 'string', enum: ['one_time', 'per_session', 'subscription'] },
    max_participants: { type: 'integer', nullable: true },
    current_participants: { type: 'integer' },
    prerequisites: { type: 'string', nullable: true },
    what_to_expect: { type: 'string', nullable: true },
    outcomes: { type: 'object', nullable: true, additionalProperties: true },
    tags: { type: 'array', items: { type: 'string' } },
    image_url: { type: 'string', nullable: true },
    is_featured: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const PROGRAM_EXAMPLE = {
  id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
  provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  title: '12-Week Metabolic Reset',
  description: 'Structured reversal programme with weekly clinician review.',
  category: 'metabolic',
  duration_weeks: 12,
  session_count: 12,
  session_duration_minutes: 60,
  price: '1200.00',
  price_type: 'one_time',
  current_participants: 0,
  tags: ['diabetes', 'reversal'],
  is_featured: false,
  status: 'draft',
};

const PRODUCT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    short_description: { type: 'string', nullable: true },
    category: { type: 'string' },
    price: { type: 'string', description: 'Numeric, serialised as a string' },
    compare_at_price: { type: 'string', nullable: true },
    inventory_count: { type: 'integer', description: 'Set from `stockQuantity` on create' },
    sku: { type: 'string', nullable: true },
    image_urls: {
      type: 'array',
      items: { type: 'string' },
      description: 'Set from `images` on create',
    },
    tags: { type: 'array', items: { type: 'string' } },
    attributes: { type: 'object', nullable: true, additionalProperties: true },
    is_digital: { type: 'boolean' },
    digital_file_url: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['draft', 'active', 'out_of_stock', 'archived'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const PRODUCT_EXAMPLE = {
  id: 'c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f',
  provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  title: 'Continuous Glucose Monitor Starter Kit',
  description: 'Two sensors plus onboarding call.',
  category: 'devices',
  price: '149.00',
  inventory_count: 25,
  image_urls: [],
  tags: ['cgm'],
  is_digital: false,
  status: 'draft',
};

const CATEGORY_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string', nullable: true },
    parent_id: { type: 'string', format: 'uuid', nullable: true },
    icon_url: { type: 'string', nullable: true },
    sort_order: { type: 'integer' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const AVAILABILITY_RULE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    day_of_week: {
      type: 'string',
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    },
    start_time: { type: 'string', example: '09:00:00' },
    end_time: { type: 'string', example: '17:00:00' },
    timezone: { type: 'string', example: 'America/New_York' },
    slot_duration_minutes: { type: 'integer' },
    buffer_minutes: { type: 'integer' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const AVAILABILITY_OVERRIDE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    date: { type: 'string', format: 'date' },
    start_time: { type: 'string', nullable: true, example: '13:00:00' },
    end_time: { type: 'string', nullable: true, example: '15:00:00' },
    is_blocked: { type: 'boolean' },
    reason: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const AVAILABILITY_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    rules: { type: 'array', items: AVAILABILITY_RULE_SHAPE },
    overrides: {
      type: 'array',
      items: AVAILABILITY_OVERRIDE_SHAPE,
      description: 'Only overrides dated today or later',
    },
  },
};

const SLOT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    startTime: { type: 'string', example: '09:00', description: 'HH:mm' },
    endTime: { type: 'string', example: '10:00' },
    available: { type: 'boolean', description: 'False when a partial-day override covers it' },
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

const STATS_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    provider: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: {
          type: 'string',
          enum: ['pending', 'verified', 'suspended', 'rejected', 'deactivated'],
        },
        ratingAvg: { type: 'string' },
        reviewCount: { type: 'integer' },
        totalBookings: { type: 'integer' },
      },
    },
    programs: {
      type: 'object',
      properties: { total: { type: 'integer' }, active: { type: 'integer' } },
    },
    products: {
      type: 'object',
      properties: { total: { type: 'integer' }, active: { type: 'integer' } },
    },
    reviews: { type: 'object', properties: { total: { type: 'integer' } } },
  },
};

const SUCCESS_FLAG_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: { success: { type: 'boolean', example: true } },
};

export function createProviderRoutes(controller: ProviderController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole(UserRole.PROVIDER);

  return (
    new Elysia({ prefix: '/providers' })
      // Public endpoints
      .get('/categories', controller.listCategories, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'List provider categories',
          description:
            'Top-level active provider categories, ordered by `sort_order`. Sub-categories are filtered out — anything with a `parent_id` is not returned here. No token required; use this to populate a category picker before the user signs in.',
          responses: {
            200: okDoc('Active top-level categories', { type: 'array', items: CATEGORY_SHAPE }, [
              {
                id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
                name: 'Metabolic Health',
                slug: 'metabolic-health',
                parent_id: null,
                sort_order: 1,
                is_active: true,
              },
            ]),
            500: publicServerError,
          },
        },
      })
      .get('', controller.listProviders, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'List active providers (public)',
          description:
            'Public directory listing, ordered by rating (highest first). Includes providers whose status is `verified` **or** `pending` — a newly registered provider is visible here before an admin verifies it, so render the status if that matters to your UI. Suspended, rejected and deactivated providers are excluded. For full-text search across providers, programs and products together, use `GET /marketplace/search` instead.',
          parameters: [
            {
              name: 'search',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Case-insensitive substring match on business name or display name',
            },
            {
              name: 'offersVirtual',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'Filter to providers who do (or do not) offer virtual sessions',
            },
            {
              name: 'offersInPerson',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'Filter to providers who do (or do not) offer in-person sessions',
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Accepted and parsed, but **not currently applied** by the query — filter by category through `GET /marketplace/providers` instead.',
            },
            {
              name: 'minRating',
              in: 'query',
              required: false,
              schema: { type: 'number', minimum: 0, maximum: 5 },
              description:
                'Accepted and parsed, but **not currently applied** by the query — use `GET /marketplace/providers?minRating=` instead.',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc('One page of providers', PROVIDER_SHAPE, PROVIDER_EXAMPLE),
            500: publicServerError,
          },
        },
      })
      .get('/:id', controller.getPublicProfile, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'Get provider public profile',
          description:
            'The provider storefront: the provider record plus the owner’s display name and avatar, and every `active` program and product they publish. Draft, paused and archived listings are not included. A deactivated provider answers `404`, the same as an id that never existed.',
          parameters: [providerIdParam],
          responses: {
            200: okDoc('Provider with its owner, active programs and active products', {
              ...PROVIDER_SHAPE,
              properties: {
                ...PROVIDER_SHAPE.properties,
                user: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    avatar_url: { type: 'string', nullable: true },
                  },
                },
                programs: { type: 'array', items: PROGRAM_SHAPE },
                products: { type: 'array', items: PRODUCT_SHAPE },
              },
            }),
            404: errorDoc('No such provider, or the provider is deactivated', 'NOT_FOUND'),
          },
        },
      })
      .get('/:id/slots', controller.getSlots, {
        query: slotsQuerySchema,
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'Get available booking slots for a provider',
          description:
            'Expands the provider’s weekly rules into concrete slots for one calendar date, applying same-day overrides. Returns `[]` when the whole day is blocked or no rule covers that weekday. `date` is required and validated: omitting it, or sending anything that is not `YYYY-MM-DD`, answers `400 VALIDATION_ERROR` before the handler runs. These are schedule slots only: this service does not know about bookings, so `available: true` means "not blocked by an override", not "nobody has booked it".',
          parameters: [
            providerIdParam,
            {
              name: 'date',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'date', example: '2026-09-01' },
              description: 'YYYY-MM-DD — the day to expand',
            },
            {
              name: 'timezone',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'America/New_York' },
              description:
                'Accepted for forward compatibility but **not currently applied** — slot times come back exactly as stored on the rule.',
            },
          ],
          responses: {
            200: okDoc('Slots for the requested date', { type: 'array', items: SLOT_SHAPE }, [
              { startTime: '09:00', endTime: '10:00', available: true },
              { startTime: '10:15', endTime: '11:15', available: false },
            ]),
            400: errorDoc('`date` is missing or is not a `YYYY-MM-DD` date', 'VALIDATION_ERROR'),
          },
        },
      })
      .get('/:id/programs', controller.getProviderPrograms, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'Get programs offered by a provider',
          description:
            'Paginated list of this provider’s `active` programs, newest first. An unknown provider id is not an error here — it answers `200` with an empty page, so do not use this endpoint to test whether a provider exists.',
          parameters: [providerIdParam, ...pageParams],
          responses: {
            200: pagedDoc('One page of active programs', PROGRAM_SHAPE, {
              ...PROGRAM_EXAMPLE,
              status: 'active',
            }),
            500: publicServerError,
          },
        },
      })
      .get('/:id/products', controller.getProviderProducts, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'Get products offered by a provider',
          description:
            'Paginated list of this provider’s `active` products, newest first. As with programs, an unknown provider id answers `200` with an empty page rather than `404`.',
          parameters: [providerIdParam, ...pageParams],
          responses: {
            200: pagedDoc('One page of active products', PRODUCT_SHAPE, {
              ...PRODUCT_EXAMPLE,
              status: 'active',
            }),
            500: publicServerError,
          },
        },
      })
      .get('/:id/availability', controller.getPublicAvailability, {
        detail: {
          tags: PUBLIC_TAGS,
          summary: 'Get provider availability schedule',
          description:
            'The provider’s recurring weekly rules (active ones only) plus any upcoming date overrides — today onwards, past overrides are not returned. Use this to render a week view; use `GET /providers/{id}/slots?date=` to get bookable slots for one day.',
          parameters: [providerIdParam],
          responses: {
            200: okDoc('Weekly rules and upcoming overrides', AVAILABILITY_SHAPE),
            404: errorDoc('No such provider, or the provider is deactivated', 'NOT_FOUND'),
          },
        },
      })
      // Auth-required endpoints
      .use(authRequired)
      .post('/register', controller.register, {
        body: documented(providerRegisterSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Register as a provider',
          description:
            'Turns the authenticated account into a provider. Creates the `providers` row with status `pending` and publishes `provider.registered`. One provider per account — a second call answers `409`. The new provider is already visible in the public directory while pending, but must be verified by an admin before it counts as active. `phone` is accepted by the schema but not persisted on the provider record; `address` is stored as the provider `location` JSON. Note that the caller does **not** yet hold the `provider` role at this point — the token must be refreshed before the `/providers/me/*` routes will accept it.',
          ...bearer,
          requestBody: bodyDoc(providerRegisterSchema),
          responses: {
            201: okDoc('Provider created, pending verification', PROVIDER_SHAPE, {
              ...PROVIDER_EXAMPLE,
              status: 'pending',
              rating_avg: '0.00',
              review_count: 0,
              total_bookings: 0,
            }),
            400: validationError,
            401: unauthorized,
            404: errorDoc('No user record exists for this token', 'NOT_FOUND'),
            409: errorDoc('This account is already registered as a provider', 'CONFLICT'),
          },
        },
      })
      .use(providerRequired)
      .get('/me', controller.getOwnProfile, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Get own provider profile',
          description:
            'The caller’s own `providers` row, resolved from the token — no id in the path. Unlike the public profile, this returns the record at any status, so a suspended provider can still read their own dashboard.',
          ...bearer,
          responses: {
            200: okDoc('The caller’s provider record', PROVIDER_SHAPE, PROVIDER_EXAMPLE),
            ...ownProviderErrors,
          },
        },
      })
      .put('/me', controller.updateProfile, {
        body: documented(updateProviderProfileSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Update own provider profile',
          description:
            'Partial update despite being a PUT — send only the fields you want to change; anything omitted is left alone. Publishes `provider.updated` with the changed keys. Status, rating, review count and booking totals are not writable here: status moves only through the admin routes.',
          ...bearer,
          requestBody: bodyDoc(updateProviderProfileSchema),
          responses: {
            200: okDoc('Updated provider record', PROVIDER_SHAPE, PROVIDER_EXAMPLE),
            400: validationError,
            ...ownProviderErrors,
          },
        },
      })
      .post('/me/verification', controller.submitVerification, {
        body: documented(verificationDocumentSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Submit verification document',
          description:
            'Records a credential document for admin review and returns the new `provider_verification` row with status `pending`. This endpoint stores a URL you already have — it does **not** mint an S3 presigned upload URL, despite what the old summary said. For a presigned upload use `POST /providers/me/onboarding/upload-url`. An admin then approves it through `POST /admin/providers/{id}/verify`, which also flips the provider to `verified`.',
          ...bearer,
          requestBody: bodyDoc(verificationDocumentSchema),
          responses: {
            201: okDoc('Verification document recorded, awaiting review', VERIFICATION_SHAPE, {
              id: 'd7e8f9a0-b1c2-4d3e-8f40-5a6b7c8d9e0f',
              provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
              document_type: 'medical_license',
              document_url: 'https://files.longeny.com/verifications/license.pdf',
              status: 'pending',
              reviewer_id: null,
              reviewed_at: null,
            }),
            400: validationError,
            ...ownProviderErrors,
          },
        },
      })
      .get('/me/availability', controller.getAvailability, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Get own availability',
          description:
            'The caller’s weekly rules — including inactive ones, unlike the public view — plus overrides dated today or later.',
          ...bearer,
          responses: {
            200: okDoc('Own weekly rules and upcoming overrides', AVAILABILITY_SHAPE),
            ...ownProviderErrors,
          },
        },
      })
      .put('/me/availability', controller.setAvailability, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Set weekly availability schedule',
          description:
            '**Full replace, not a merge**: every existing rule for this provider is deleted and the posted array is inserted in one transaction. Send the complete week each time; posting `[]` clears the schedule. The response is the same body as `GET /providers/me/availability`, so the client does not need a follow-up read. Existing overrides are untouched.',
          ...bearer,
          requestBody: {
            required: true,
            description:
              'Either a bare array of rules, or `{ "rules": [...] }`. There is no schema on this route, so the body is not validated — a malformed rule surfaces as a database error, not a `400 VALIDATION_ERROR`.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rules: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['dayOfWeek', 'startTime', 'endTime'],
                        properties: {
                          dayOfWeek: {
                            type: 'string',
                            enum: [
                              'monday',
                              'tuesday',
                              'wednesday',
                              'thursday',
                              'friday',
                              'saturday',
                              'sunday',
                            ],
                          },
                          startTime: { type: 'string', example: '09:00' },
                          endTime: { type: 'string', example: '17:00' },
                          slotDurationMinutes: { type: 'integer', default: 60 },
                          isAvailable: { type: 'boolean', default: true },
                        },
                      },
                    },
                  },
                },
                example: {
                  rules: [
                    {
                      dayOfWeek: 'monday',
                      startTime: '09:00',
                      endTime: '17:00',
                      slotDurationMinutes: 60,
                      isAvailable: true,
                    },
                  ],
                },
              },
            },
          },
          responses: {
            200: okDoc('The schedule as it now stands', AVAILABILITY_SHAPE),
            ...ownProviderErrors,
          },
        },
      })
      .post('/me/availability/overrides', controller.addAvailabilityOverride, {
        body: documented(availabilityOverrideSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Add availability override (block or add a specific date)',
          description:
            'A one-date exception to the weekly rules. Omit `startTime`/`endTime` with `isBlocked: true` to block the whole day; give a time window to block only part of it. Overrides accumulate — adding one never replaces another — so remove them individually.',
          ...bearer,
          requestBody: bodyDoc(availabilityOverrideSchema),
          responses: {
            201: okDoc('Override created', AVAILABILITY_OVERRIDE_SHAPE, {
              id: 'e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7',
              provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
              date: '2026-09-01',
              start_time: null,
              end_time: null,
              is_blocked: true,
              reason: 'Conference',
            }),
            400: validationError,
            ...ownProviderErrors,
          },
        },
      })
      .delete('/me/availability/overrides/:id', controller.removeAvailabilityOverride, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Remove availability override',
          description:
            'Hard-deletes one override. Ownership is checked in the same query as the lookup, so another provider’s override answers `404` exactly like an id that does not exist.',
          ...bearer,
          parameters: [uuidPath('id', 'Override id (`availability_overrides.id`)')],
          responses: {
            200: okDoc('Override removed', SUCCESS_FLAG_SHAPE, { success: true }),
            401: unauthorized,
            403: providerRoleForbidden,
            404: errorDoc(
              'No such override, or it belongs to another provider — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
      .get('/me/programs', controller.getOwnPrograms, {
        detail: {
          tags: OWN_TAGS,
          summary: 'List own programs',
          description:
            'Every program the caller owns at any status, newest first — this is the seller-side view, so drafts and archived programs are included. Filter with `status` to build tabs.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'] },
              description: 'Restrict to one lifecycle status',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc('One page of own programs', PROGRAM_SHAPE, PROGRAM_EXAMPLE),
            ...ownProviderErrors,
          },
        },
      })
      .post('/me/programs', controller.createProgram, {
        body: documented(programSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Create a program',
          description:
            'Creates a program owned by the caller and publishes `provider.program.created`. It starts as a **draft** and is invisible in the marketplace until you `PUT` it to `active`. `sessionsPerWeek` is not stored directly — it is multiplied by `durationWeeks` into `session_count`. `currency` is accepted by the schema but there is no currency column on programs, so it is silently dropped; prices are effectively in the provider’s currency.',
          ...bearer,
          requestBody: bodyDoc(programSchema),
          responses: {
            201: okDoc('Program created as a draft', PROGRAM_SHAPE, PROGRAM_EXAMPLE),
            400: validationError,
            ...ownProviderErrors,
          },
        },
      })
      .put('/me/programs/:id', controller.updateProgram, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Update a program',
          description:
            'Partial update of one of the caller’s own programs; publishes `provider.program.updated` with the changed keys. This is also how a draft is published — send `{ "status": "active" }`. Only the mapped keys below are applied; anything else in the body is ignored rather than rejected.',
          ...bearer,
          parameters: [uuidPath('id', 'Program id — must belong to the calling provider')],
          requestBody: {
            required: true,
            description:
              'No schema is attached to this route, so the body is not validated and an unknown key is ignored silently. Every field is optional.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    shortDescription: { type: 'string' },
                    category: { type: 'string' },
                    subcategory: { type: 'string' },
                    durationWeeks: { type: 'integer' },
                    sessionCount: { type: 'integer' },
                    sessionDurationMinutes: { type: 'integer' },
                    price: { type: 'number' },
                    priceType: {
                      type: 'string',
                      enum: ['one_time', 'per_session', 'subscription'],
                    },
                    maxParticipants: { type: 'integer' },
                    prerequisites: { type: 'string' },
                    whatToExpect: { type: 'string' },
                    outcomes: { type: 'object', additionalProperties: true },
                    tags: { type: 'array', items: { type: 'string' } },
                    imageUrl: { type: 'string' },
                    status: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'] },
                  },
                },
                example: { status: 'active', price: 1100 },
              },
            },
          },
          responses: {
            200: okDoc('Updated program', PROGRAM_SHAPE, { ...PROGRAM_EXAMPLE, status: 'active' }),
            401: unauthorized,
            403: providerRoleForbidden,
            404: errorDoc(
              'No such program, or it belongs to another provider — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
      .delete('/me/programs/:id', controller.deleteProgram, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Archive a program (soft delete)',
          description:
            'Sets the program’s status to `archived`; the row is **not** removed, so participant history and past bookings keep resolving. An archived program disappears from the public provider profile and from marketplace search. There is no un-archive shortcut — `PUT /providers/me/programs/{id}` with `{ "status": "active" }` brings it back.',
          ...bearer,
          parameters: [uuidPath('id', 'Program id — must belong to the calling provider')],
          responses: {
            200: okDoc('Program archived', SUCCESS_FLAG_SHAPE, { success: true }),
            401: unauthorized,
            403: providerRoleForbidden,
            404: errorDoc(
              'No such program, or it belongs to another provider — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
      .post('/me/products', controller.createProduct, {
        body: documented(productSchema),
        detail: {
          tags: OWN_TAGS,
          summary: 'Create a product',
          description:
            'Creates a physical or digital product owned by the caller and publishes `provider.product.created`. Starts as a **draft**; publish it with `PUT /providers/me/products/{id}` and `{ "status": "active" }`. `stockQuantity` lands in `inventory_count` and `images` in `image_urls`. As with programs, `currency` is accepted by the schema but there is no currency column, so it is dropped.',
          ...bearer,
          requestBody: bodyDoc(productSchema),
          responses: {
            201: okDoc('Product created as a draft', PRODUCT_SHAPE, PRODUCT_EXAMPLE),
            400: validationError,
            ...ownProviderErrors,
          },
        },
      })
      .put('/me/products/:id', controller.updateProduct, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Update a product',
          description:
            'Partial update of one of the caller’s own products, and the way a draft is published (`{ "status": "active" }`). No event is published for product updates. Only the mapped keys below are applied; unknown keys are ignored rather than rejected.',
          ...bearer,
          parameters: [uuidPath('id', 'Product id — must belong to the calling provider')],
          requestBody: {
            required: true,
            description:
              'No schema is attached to this route, so the body is not validated. Every field is optional.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    shortDescription: { type: 'string' },
                    category: { type: 'string' },
                    price: { type: 'number' },
                    compareAtPrice: { type: 'number' },
                    stockQuantity: { type: 'integer' },
                    sku: { type: 'string' },
                    images: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string' } },
                    attributes: { type: 'object', additionalProperties: true },
                    isDigital: { type: 'boolean' },
                    digitalFileUrl: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['draft', 'active', 'out_of_stock', 'archived'],
                    },
                  },
                },
                example: { status: 'active', stockQuantity: 40 },
              },
            },
          },
          responses: {
            200: okDoc('Updated product', PRODUCT_SHAPE, { ...PRODUCT_EXAMPLE, status: 'active' }),
            401: unauthorized,
            403: providerRoleForbidden,
            404: errorDoc(
              'No such product, or it belongs to another provider — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
      .delete('/me/products/:id', controller.deleteProduct, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Archive a product (soft delete)',
          description:
            'Sets the product’s status to `archived`; the row survives so past orders keep resolving. Archived products drop out of the public profile and marketplace search. Re-publish with `PUT /providers/me/products/{id}` and `{ "status": "active" }`.',
          ...bearer,
          parameters: [uuidPath('id', 'Product id — must belong to the calling provider')],
          responses: {
            200: okDoc('Product archived', SUCCESS_FLAG_SHAPE, { success: true }),
            401: unauthorized,
            403: providerRoleForbidden,
            404: errorDoc(
              'No such product, or it belongs to another provider — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
      .get('/me/products', controller.getOwnProducts, {
        detail: {
          tags: OWN_TAGS,
          summary: 'List own products',
          description:
            'Every product the caller owns at any status, newest first — drafts and archived items included. Filter with `status` to build tabs.',
          ...bearer,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['draft', 'active', 'out_of_stock', 'archived'] },
              description: 'Restrict to one lifecycle status',
            },
            ...pageParams,
          ],
          responses: {
            200: pagedDoc('One page of own products', PRODUCT_SHAPE, PRODUCT_EXAMPLE),
            ...ownProviderErrors,
          },
        },
      })
      .get('/me/stats', controller.getProviderStats, {
        detail: {
          tags: OWN_TAGS,
          summary: 'Get own provider stats',
          description:
            'Dashboard counters for the caller: current status and rating, program and product totals split by active, and the number of reviews written about them. Counts are computed live, so this is safe to call on page load but not in a tight poll.',
          ...bearer,
          responses: {
            200: okDoc('Counters for the caller’s provider account', STATS_SHAPE, {
              provider: {
                id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
                status: 'verified',
                ratingAvg: '4.70',
                reviewCount: 31,
                totalBookings: 208,
              },
              programs: { total: 4, active: 3 },
              products: { total: 2, active: 1 },
              reviews: { total: 31 },
            }),
            ...ownProviderErrors,
          },
        },
      })
  );
}
