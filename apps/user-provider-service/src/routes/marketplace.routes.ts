import { requireAuth } from '@longeny/middleware';
import { Elysia } from 'elysia';
import type { MarketplaceController } from '../controllers/marketplace.controller.js';
import { savedItemSchema } from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Marketplace'];

const unauthorized = errorDoc('Missing, expired or revoked bearer token', 'UNAUTHORIZED');

/**
 * Public browse/search routes take no id and no body, so they have no
 * domain-level failure: the only thing a client can see other than 200 is a
 * server error. Documented explicitly so nobody codes a 401/404 branch that can
 * never fire. Bad `page`/`limit` values fall back to the defaults rather than
 * erroring.
 */
const publicServerError = errorDoc(
  'Unexpected server error. This route is unauthenticated and takes no resource id, so 200 and 500 are the only outcomes.',
  'INTERNAL_ERROR',
);

// ── Response shapes ──────────────────────────────────────────────────────────

/** buildPaginationMeta() — this surface does carry hasNext/hasPrev. */
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

/**
 * A `search_index` row. Everything searchable — providers, programs and
 * products — is denormalised into this one table, so a result set can mix all
 * three; switch on `entity_type` and follow `entity_id` to the detail route.
 */
const LISTING_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Index row id, not the entity id' },
    entity_type: { type: 'string', enum: ['provider', 'program', 'product'] },
    entity_id: {
      type: 'string',
      format: 'uuid',
      description: 'The id to pass to the matching detail route',
    },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    subcategory: { type: 'string', nullable: true },
    tags: { type: 'array', items: { type: 'string' } },
    specialties: { type: 'array', items: { type: 'string' } },
    location_city: { type: 'string', nullable: true },
    location_state: { type: 'string', nullable: true },
    location_lat: { type: 'string', nullable: true },
    location_lng: { type: 'string', nullable: true },
    price_min: { type: 'string', nullable: true, description: 'Numeric, serialised as a string' },
    price_max: { type: 'string', nullable: true },
    rating_avg: { type: 'string' },
    review_count: { type: 'integer' },
    provider_id: { type: 'string', format: 'uuid', nullable: true },
    provider_name: { type: 'string', nullable: true },
    provider_verified: { type: 'boolean' },
    offers_virtual: { type: 'boolean' },
    offers_in_person: { type: 'boolean' },
    ai_relevance_score: { type: 'string', nullable: true },
    popularity_score: { type: 'integer' },
    image_url: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'inactive', 'featured', 'archived'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    relevance: {
      type: 'number',
      description: 'Full-text rank — present only when `q` was supplied',
    },
  },
};

const LISTING_EXAMPLE = {
  id: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  entity_type: 'program',
  entity_id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
  title: '12-Week Metabolic Reset',
  description: 'Structured reversal programme with weekly clinician review.',
  category: 'metabolic',
  tags: ['diabetes', 'reversal'],
  specialties: [],
  location_city: 'Austin',
  location_state: 'TX',
  price_min: '1200.00',
  price_max: '1200.00',
  rating_avg: '4.70',
  review_count: 31,
  provider_id: '9f1c1d9c-2f8f-4b2f-9a29-8c0e0b3d5a11',
  provider_name: 'Ridgeview Metabolic Health',
  provider_verified: true,
  offers_virtual: true,
  offers_in_person: false,
  popularity_score: 84,
  status: 'active',
};

function searchDoc(description: string): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: LISTING_SHAPE },
            pagination: PAGINATION_SHAPE,
          },
        },
        example: {
          success: true,
          data: [LISTING_EXAMPLE],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        },
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
    hourly_rate: { type: 'string', nullable: true },
    currency: { type: 'string', example: 'USD' },
    location: { type: 'object', nullable: true, additionalProperties: true },
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
    cancellation_policy: { type: 'string', nullable: true },
    cancellation_hours: { type: 'integer' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const OWNER_SHAPE: OpenApiFragment = {
  type: 'object',
  nullable: true,
  properties: {
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    avatar_url: { type: 'string', nullable: true },
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

const PRODUCT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    short_description: { type: 'string', nullable: true },
    category: { type: 'string' },
    price: { type: 'string' },
    compare_at_price: { type: 'string', nullable: true },
    inventory_count: { type: 'integer' },
    sku: { type: 'string', nullable: true },
    image_urls: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    attributes: { type: 'object', nullable: true, additionalProperties: true },
    is_digital: { type: 'boolean' },
    digital_file_url: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['draft', 'active', 'out_of_stock', 'archived'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

/** The provider block hung off a program/product detail response. */
const NESTED_PROVIDER_SHAPE: OpenApiFragment = {
  type: 'object',
  nullable: true,
  properties: { ...PROVIDER_SHAPE.properties, user: OWNER_SHAPE },
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
    listing_count: { type: 'integer' },
    sort_order: { type: 'integer' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const SAVED_ITEM_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: {
      type: 'string',
      format: 'uuid',
      description: 'The token subject (auth id) of the account that saved it',
    },
    entity_type: { type: 'string', enum: ['provider', 'program', 'product'] },
    entity_id: { type: 'string', format: 'uuid' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const SAVED_ITEM_EXAMPLE = {
  id: 'a0b1c2d3-e4f5-4061-8273-8495a6b7c8d9',
  user_id: '22222222-2222-2222-2222-222222222222',
  entity_type: 'program',
  entity_id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
  created_at: '2026-08-20T11:04:00.000Z',
};

// ── Query parameters ─────────────────────────────────────────────────────────

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
    description: 'Results per page',
  },
];

const qParam: OpenApiFragment = {
  name: 'q',
  in: 'query',
  required: false,
  schema: { type: 'string' },
  description:
    'Full-text query, parsed with Postgres `websearch_to_tsquery` — quotes and `or`/`-` work as in a search engine. Omit it to browse.',
};

const priceParams: OpenApiFragment = [
  {
    name: 'minPrice',
    in: 'query',
    required: false,
    schema: { type: 'number', minimum: 0 },
    description: 'Lower bound on the listing price',
  },
  {
    name: 'maxPrice',
    in: 'query',
    required: false,
    schema: { type: 'number', minimum: 0 },
    description: 'Upper bound on the listing price',
  },
];

const sortParam: OpenApiFragment = {
  name: 'sortBy',
  in: 'query',
  required: false,
  schema: {
    type: 'string',
    enum: ['relevance', 'rating', 'price_asc', 'price_desc', 'newest', 'popularity'],
    default: 'relevance',
  },
  description:
    '`relevance` ranks by text match when `q` is present and by popularity when it is not.',
};

export function createMarketplaceRoutes(controller: MarketplaceController) {
  const authRequired = requireAuth();

  return (
    new Elysia({ prefix: '/marketplace' })
      // Public endpoints
      .get('/search', controller.search, {
        detail: {
          tags: TAGS,
          summary: 'Search providers, programs and products',
          description:
            'The one search box for the whole marketplace. Queries the denormalised `search_index`, so a single result page can mix providers, programs and products — switch on `entity_type` and follow `entity_id` to the right detail route. Only `active` listings are indexed, so drafts and archived items never appear. No token required.',
          parameters: [
            qParam,
            {
              name: 'entityType',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['provider', 'program', 'product'] },
              description: 'Restrict to one kind of listing',
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact category match',
            },
            {
              name: 'subcategory',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact subcategory match',
            },
            ...priceParams,
            {
              name: 'offersVirtual',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'Virtual delivery filter',
            },
            {
              name: 'offersInPerson',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'In-person delivery filter',
            },
            {
              name: 'city',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Indexed city of the listing',
            },
            {
              name: 'state',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Indexed state of the listing',
            },
            {
              name: 'minRating',
              in: 'query',
              required: false,
              schema: { type: 'number', minimum: 0, maximum: 5 },
              description: 'Only listings rated at or above this',
            },
            sortParam,
            ...pageParams,
          ],
          responses: {
            200: searchDoc('One page of mixed listings'),
            500: publicServerError,
          },
        },
      })
      .get('/search/suggestions', controller.getSearchSuggestions, {
        detail: {
          tags: TAGS,
          summary: 'Get search autocomplete suggestions',
          description:
            'Type-ahead titles for the search box. Matches `title` case-insensitively anywhere in the string and returns distinct pairs of title and entity type — not full listings, and no ids, so a suggestion feeds the search box rather than linking straight to a detail page. Returns `[]` when `q` is shorter than 2 characters, so it is safe to call on every keystroke.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: false,
              schema: { type: 'string', minLength: 2 },
              description: 'Partial title. Fewer than 2 characters yields an empty list.',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, default: 10 },
              description: 'Maximum suggestions to return',
            },
          ],
          responses: {
            200: okDoc(
              'Distinct title/type pairs, alphabetical',
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    entity_type: { type: 'string', enum: ['provider', 'program', 'product'] },
                  },
                },
              },
              [{ title: '12-Week Metabolic Reset', entity_type: 'program' }],
            ),
            500: publicServerError,
          },
        },
      })
      .get('/featured', controller.getFeaturedListings, {
        detail: {
          tags: TAGS,
          summary: 'Get featured listings',
          description:
            'Editorially placed listings whose run window covers today, ordered by `position` and capped at 20 — this is the home-page hero rail. Each row is the placement itself with the indexed listing attached as `entity`; `entity` can be `null` when the placement points at something no longer active, so guard for it. Returns `[]` when nothing is scheduled.',
          responses: {
            200: okDoc(
              'Current featured placements with their listings',
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    entity_type: { type: 'string', enum: ['provider', 'program', 'product'] },
                    entity_id: { type: 'string', format: 'uuid' },
                    position: { type: 'integer' },
                    start_date: { type: 'string', format: 'date' },
                    end_date: { type: 'string', format: 'date' },
                    status: {
                      type: 'string',
                      enum: ['active', 'inactive', 'featured', 'archived'],
                    },
                    created_by: { type: 'string', format: 'uuid', nullable: true },
                    created_at: { type: 'string', format: 'date-time' },
                    entity: { ...LISTING_SHAPE, nullable: true },
                  },
                },
              },
              [
                {
                  id: 'f1e2d3c4-b5a6-4978-8695-a4b3c2d1e0f9',
                  entity_type: 'program',
                  entity_id: 'b1a2c3d4-e5f6-4708-9a1b-2c3d4e5f6071',
                  position: 1,
                  start_date: '2026-08-01',
                  end_date: '2026-09-30',
                  status: 'active',
                  entity: LISTING_EXAMPLE,
                },
              ],
            ),
            500: publicServerError,
          },
        },
      })
      .get('/trending', controller.getTrending, {
        detail: {
          tags: TAGS,
          summary: 'Get trending providers and programs',
          description:
            'Active listings ranked by `popularity_score`, then rating. Popularity is a stored counter, not a live computation, so this is a cheap call and the ordering only moves when the index is refreshed. Mixed entity types — switch on `entity_type`.',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, default: 20 },
              description: 'How many listings to return',
            },
          ],
          responses: {
            200: okDoc('Listings by popularity', { type: 'array', items: LISTING_SHAPE }, [
              LISTING_EXAMPLE,
            ]),
            500: publicServerError,
          },
        },
      })
      .get('/providers', controller.searchProviders, {
        detail: {
          tags: TAGS,
          summary: 'Search providers with filters',
          description:
            '`GET /marketplace/search` pinned to `entityType=provider`, so every row comes back with `entity_type: "provider"` and `entity_id` is the provider id. Prefer this over `GET /providers` when you need text search, price, location or rating filters.',
          parameters: [
            qParam,
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact category match',
            },
            ...priceParams,
            {
              name: 'offersVirtual',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'Virtual delivery filter',
            },
            {
              name: 'offersInPerson',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'In-person delivery filter',
            },
            {
              name: 'city',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Indexed city',
            },
            {
              name: 'state',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Indexed state',
            },
            {
              name: 'minRating',
              in: 'query',
              required: false,
              schema: { type: 'number', minimum: 0, maximum: 5 },
              description: 'Only providers rated at or above this',
            },
            sortParam,
            ...pageParams,
          ],
          responses: {
            200: searchDoc('One page of provider listings'),
            500: publicServerError,
          },
        },
      })
      .get('/providers/:slug', controller.getProviderBySlug, {
        detail: {
          tags: TAGS,
          summary: 'Get provider by slug',
          description:
            'Storefront page for one provider, with the owner’s name and avatar and every `active` program and product. Despite the parameter name this is **not** a slug lookup: the value is matched exactly against `display_name` or `business_name`, so it must be URL-encoded and spelled exactly as stored. Deactivated providers are excluded and answer `404`.',
          parameters: [
            {
              name: 'slug',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description:
                'The provider’s exact display name or business name, URL-encoded — not a slugified string',
            },
          ],
          responses: {
            200: okDoc('Provider with owner, active programs and active products', {
              ...PROVIDER_SHAPE,
              properties: {
                ...PROVIDER_SHAPE.properties,
                user: OWNER_SHAPE,
                programs: { type: 'array', items: PROGRAM_SHAPE },
                products: { type: 'array', items: PRODUCT_SHAPE },
              },
            }),
            404: errorDoc('No active provider matches that name', 'NOT_FOUND'),
          },
        },
      })
      .get('/programs', controller.searchPrograms, {
        detail: {
          tags: TAGS,
          summary: 'Search programs',
          description:
            '`GET /marketplace/search` pinned to `entityType=program`. `entity_id` on each row is the program id to pass to `GET /marketplace/programs/{id}`. Location and delivery filters are not offered here — a program inherits those from its provider.',
          parameters: [
            qParam,
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact category match',
            },
            {
              name: 'subcategory',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact subcategory match',
            },
            ...priceParams,
            sortParam,
            ...pageParams,
          ],
          responses: {
            200: searchDoc('One page of program listings'),
            500: publicServerError,
          },
        },
      })
      .get('/programs/:id', controller.getProgramDetail, {
        detail: {
          tags: TAGS,
          summary: 'Get program detail',
          description:
            'The full program record with its provider (and the provider owner’s name and avatar) nested under `provider`. `provider` can be `null` if the owning provider row has gone. This is the canonical detail payload for a program page — search results carry only the indexed summary.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Program id (`programs.id`) — the `entity_id` from a search result',
            },
          ],
          responses: {
            200: okDoc('Program with its provider', {
              ...PROGRAM_SHAPE,
              properties: { ...PROGRAM_SHAPE.properties, provider: NESTED_PROVIDER_SHAPE },
            }),
            404: errorDoc('No such program', 'NOT_FOUND'),
          },
        },
      })
      .get('/products', controller.searchProducts, {
        detail: {
          tags: TAGS,
          summary: 'Search products',
          description:
            '`GET /marketplace/search` pinned to `entityType=product`. `entity_id` on each row is the product id for `GET /marketplace/products/{id}`.',
          parameters: [
            qParam,
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Exact category match',
            },
            ...priceParams,
            sortParam,
            ...pageParams,
          ],
          responses: {
            200: searchDoc('One page of product listings'),
            500: publicServerError,
          },
        },
      })
      .get('/products/:id', controller.getProductDetail, {
        detail: {
          tags: TAGS,
          summary: 'Get product detail',
          description:
            'The full product record with its provider nested under `provider`, which can be `null` if the owning provider row has gone. Read `inventory_count` and `status` before offering a buy button — an out-of-stock product still resolves here.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Product id (`products.id`) — the `entity_id` from a search result',
            },
          ],
          responses: {
            200: okDoc('Product with its provider', {
              ...PRODUCT_SHAPE,
              properties: { ...PRODUCT_SHAPE.properties, provider: NESTED_PROVIDER_SHAPE },
            }),
            404: errorDoc('No such product', 'NOT_FOUND'),
          },
        },
      })
      .get('/categories', controller.listCategories, {
        detail: {
          tags: TAGS,
          summary: 'List all categories',
          description:
            'The marketplace category tree, two levels deep: active top-level categories each with their active children under `children`, both sorted by `sort_order`. `listing_count` is a stored counter you can render as a badge. These are marketplace categories — `GET /providers/categories` is a separate, flat list used for provider registration.',
          responses: {
            200: okDoc(
              'Top-level categories with their children',
              {
                type: 'array',
                items: {
                  ...CATEGORY_SHAPE,
                  properties: {
                    ...CATEGORY_SHAPE.properties,
                    children: { type: 'array', items: CATEGORY_SHAPE },
                  },
                },
              },
              [
                {
                  id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
                  name: 'Metabolic Health',
                  slug: 'metabolic-health',
                  parent_id: null,
                  listing_count: 24,
                  sort_order: 1,
                  is_active: true,
                  children: [],
                },
              ],
            ),
            500: publicServerError,
          },
        },
      })
      .get('/categories/:slug', controller.getCategoryBySlug, {
        detail: {
          tags: TAGS,
          summary: 'Get category by slug',
          description:
            'A category landing page: the category with its active children, plus the 20 most popular active listings whose indexed `category` equals the category **name**. Note the two different keys — the path takes the slug, the listings are matched on the display name. Returns the category even when it has no listings.',
          parameters: [
            {
              name: 'slug',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'metabolic-health' },
              description: 'Category slug (`categories.slug`)',
            },
          ],
          responses: {
            200: okDoc('Category, its children, and its top listings', {
              type: 'object',
              properties: {
                category: {
                  ...CATEGORY_SHAPE,
                  properties: {
                    ...CATEGORY_SHAPE.properties,
                    children: { type: 'array', items: CATEGORY_SHAPE },
                  },
                },
                providers: {
                  type: 'array',
                  items: LISTING_SHAPE,
                  description:
                    'Top 20 active listings in this category by popularity — mixed entity types despite the key name',
                },
              },
            }),
            404: errorDoc('No category with that slug', 'NOT_FOUND'),
          },
        },
      })
      .get('/facets', controller.getFacets, {
        detail: {
          tags: TAGS,
          summary: 'Get search facets (filters available)',
          description:
            'Counts for the filter sidebar, computed over active listings: how many listings per category, per entity type, the overall price range, and a rating histogram bucketed by whole star (listings rated 0 are excluded). Pass the same `entityType`/`category` you have already applied so the remaining facet counts narrow with the result set.',
          parameters: [
            {
              name: 'entityType',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['provider', 'program', 'product'] },
              description: 'Scope the counts to one kind of listing',
            },
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Scope the counts to one category',
            },
          ],
          responses: {
            200: okDoc(
              'Facet counts for the current scope',
              {
                type: 'object',
                properties: {
                  categories: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        category: { type: 'string' },
                        count: { type: 'integer' },
                      },
                    },
                  },
                  entityTypes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        entity_type: { type: 'string' },
                        count: { type: 'integer' },
                      },
                    },
                  },
                  priceRange: {
                    type: 'object',
                    properties: {
                      min_price: { type: 'number', nullable: true },
                      max_price: { type: 'number', nullable: true },
                    },
                  },
                  ratingDistribution: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        rating_bucket: { type: 'integer' },
                        count: { type: 'integer' },
                      },
                    },
                  },
                },
              },
              {
                categories: [{ category: 'metabolic', count: 12 }],
                entityTypes: [{ entity_type: 'program', count: 12 }],
                priceRange: { min_price: 49, max_price: 2400 },
                ratingDistribution: [{ rating_bucket: 4, count: 9 }],
              },
            ),
            500: publicServerError,
          },
        },
      })
      // Auth-required endpoints
      .use(authRequired)
      .get('/recommendations', controller.getRecommendations, {
        detail: {
          tags: TAGS,
          summary: 'Get personalised recommendations',
          description:
            'Up to 20 active listings ordered by `ai_relevance_score`, falling back to popularity. `basedOn` tells you which story to show the user: `user_preferences` when the account has a profile row the ranking could lean on, `popularity` when it does not — so a brand-new account gets a sensible list and an honest label rather than an empty one.',
          ...bearer,
          responses: {
            200: okDoc(
              'Recommended listings and what drove them',
              {
                type: 'object',
                properties: {
                  recommendations: { type: 'array', items: LISTING_SHAPE },
                  basedOn: { type: 'string', enum: ['user_preferences', 'popularity'] },
                },
              },
              { recommendations: [LISTING_EXAMPLE], basedOn: 'user_preferences' },
            ),
            401: unauthorized,
          },
        },
      })
      .post('/saved', controller.saveItem, {
        body: documented(savedItemSchema),
        detail: {
          tags: TAGS,
          summary: 'Save a provider, program or product',
          description:
            'Adds an item to the caller’s saved list (the "wishlist"). Saving the same item twice answers `409` rather than silently succeeding, so treat a conflict as "already saved" and flip the UI rather than showing an error. Nothing checks that `entityId` refers to a real listing — a bad id is stored and simply resolves to nothing on the way back.',
          ...bearer,
          requestBody: bodyDoc(savedItemSchema),
          responses: {
            201: okDoc('Item saved', SAVED_ITEM_SHAPE, SAVED_ITEM_EXAMPLE),
            400: errorDoc(
              'Body failed validation — `entityType` must be provider/program/product and `entityId` a uuid',
              'VALIDATION_ERROR',
            ),
            401: unauthorized,
            409: errorDoc('This item is already on the caller’s saved list', 'CONFLICT'),
          },
        },
      })
      .get('/saved', controller.listSavedItems, {
        detail: {
          tags: TAGS,
          summary: 'List saved items',
          description:
            'The caller’s saved items, newest first. Rows carry only `entity_type` and `entity_id` — the listing itself is **not** joined in, so fetch each one from its detail route (or from `GET /marketplace/search`) to render titles and prices.',
          ...bearer,
          parameters: pageParams,
          responses: {
            200: {
              description: 'One page of saved items',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: { type: 'array', items: SAVED_ITEM_SHAPE },
                      pagination: PAGINATION_SHAPE,
                    },
                  },
                  example: {
                    success: true,
                    data: [SAVED_ITEM_EXAMPLE],
                    pagination: {
                      page: 1,
                      limit: 20,
                      total: 1,
                      totalPages: 1,
                      hasNext: false,
                      hasPrev: false,
                    },
                  },
                },
              },
            },
            401: unauthorized,
          },
        },
      })
      .delete('/saved/:id', controller.removeSavedItem, {
        detail: {
          tags: TAGS,
          summary: 'Remove saved item',
          description:
            'Un-saves one item. The id is the **saved-item row id** from `GET /marketplace/saved`, not the listing’s `entity_id`. Ownership is checked in the same query as the lookup, so another account’s saved item answers `404` exactly like an id that does not exist.',
          ...bearer,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Saved-item id (`saved_items.id`), not the entity id',
            },
          ],
          responses: {
            200: okDoc(
              'Item removed',
              { type: 'object', properties: { success: { type: 'boolean', example: true } } },
              { success: true },
            ),
            401: unauthorized,
            404: errorDoc(
              'No such saved item, or it belongs to another account — deliberately indistinguishable',
              'NOT_FOUND',
            ),
          },
        },
      })
  );
}
