import { auditLog, permissionGuard, requireAuth } from '@longeny/middleware';
import { Elysia } from 'elysia';
import type { ProgressController } from '../controllers/progress.controller.js';
import { profileContext } from '../middleware/profile-context.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import type { ProfileService } from '../services/profile.service.js';
import {
  createGoalSchema,
  goalProgressSchema,
  habitCheckinBodySchema,
  habitSchema,
  progressEntrySchema,
  reviewSchema,
  updateGoalSchema,
  updateHabitSchema,
} from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Progress'];

/**
 * Capability gate (layer 2 of the three the engineering standards require:
 * identity → capability → ownership).
 *
 * Progress data is the account's own health record, so it rides the seeded
 * `users:*` pair rather than a permission of its own — the `user` role already
 * holds both, and the `provider` role holds only `users:read`, which is the
 * split this surface wants: a provider may read a record, never write to it.
 * Layer 3 stays where it belongs, in ProgressService, keyed on the acting
 * profile.
 */
const READ = permissionGuard('progress:read');
const WRITE = permissionGuard('progress:write');

/**
 * Two routes are provider actions, not account-owner ones, and use the provider
 * permissions instead: only a provider answers a review about themselves, and
 * only the `provider` and `admin` roles hold `providers:write`.
 */
const PROVIDER_READ = permissionGuard('providers:read');
const PROVIDER_WRITE = permissionGuard('providers:write');

// ── Documentation fragments ──────────────────────────────────────────────────

/**
 * `profileContext` resolves this header on *every* request to this router, so
 * it is documented on every operation — including ones whose handler ends up
 * keying on the account rather than the profile, because a header naming a
 * profile the account does not own still fails the request with 404 before the
 * handler runs.
 */
const activeProfileHeader: OpenApiFragment = {
  name: 'X-Active-Profile-Id',
  in: 'header',
  required: false,
  schema: { type: 'string', format: 'uuid' },
  description:
    'Which of the account’s profiles this request acts as. Omit it and the request acts as the ' +
    'account owner’s own `self` profile, which is what a single-profile client sends. Ownership ' +
    'is re-checked on every request — activating a profile is not a session — and a profile the ' +
    'account does not own answers 404, never 403.',
};

/** Every route in this router is authenticated, profile-resolved and PHI-audited. */
const baseErrors: OpenApiFragment = {
  401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
  404: errorDoc(
    '`X-Active-Profile-Id` names a profile this account does not own (or the account has no profile yet). A profile that exists but belongs to somebody else is deliberately indistinguishable from one that does not exist.',
    'NOT_FOUND',
  ),
  503: errorDoc(
    'The server could not check whether the token was revoked (Redis unavailable). Health-data routes fail closed rather than honour a possibly-revoked token — retry shortly.',
    'REVOCATION_CHECK_UNAVAILABLE',
  ),
};

function forbidden(permission: string): OpenApiFragment {
  return { 403: errorDoc(`Token lacks the \`${permission}\` permission`, 'FORBIDDEN') };
}

/** Base errors plus the permission this route needs. */
function errorsFor(permission: string): OpenApiFragment {
  return { ...baseErrors, ...forbidden(permission) };
}

/**
 * Same, with the 404 also covering a missing or foreign resource id in the
 * path. `owner` says what the resource hangs off, because reviews and reminders
 * are keyed on the account while everything else is keyed on the profile.
 */
function errorsForResource(
  permission: string,
  resource: string,
  owner: 'profile' | 'account' = 'profile',
): OpenApiFragment {
  return {
    ...errorsFor(permission),
    404: errorDoc(
      `\`X-Active-Profile-Id\` names a profile this account does not own, or there is no such ${resource} for this ${owner} — a resource belonging to somebody else is deliberately indistinguishable from one that does not exist`,
      'NOT_FOUND',
    ),
  };
}

const validationError = errorDoc('Request body failed validation', 'VALIDATION_ERROR');

function params(...extra: OpenApiFragment[]): OpenApiFragment {
  return { parameters: [activeProfileHeader, ...extra] };
}

const idPathParam = (description: string): OpenApiFragment => ({
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description,
});

const pageParams: OpenApiFragment[] = [
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
];

const dateRangeParams: OpenApiFragment[] = [
  {
    name: 'startDate',
    in: 'query',
    required: false,
    schema: { type: 'string', example: '2026-08-01' },
    description: 'Inclusive lower bound, `YYYY-MM-DD`',
  },
  {
    name: 'endDate',
    in: 'query',
    required: false,
    schema: { type: 'string', example: '2026-08-31' },
    description: 'Inclusive upper bound, `YYYY-MM-DD`',
  },
];

/**
 * Compose a description from literal chunks plus the shared scope notes. A
 * single call rather than `'…' + NOTE`, which mixes concatenation with an
 * identifier and is rejected by the lint rules.
 */
const describe = (...parts: string[]): string => parts.join('');

/** Appended to every route whose data belongs to the acting profile. */
const PROFILE_SCOPED =
  '\n\n**Profile-scoped.** The record belongs to the profile named by `X-Active-Profile-Id` ' +
  '(the account owner’s own profile when the header is absent). Data written while acting as one ' +
  'family member is invisible to every other profile on the account, including the owner’s own — ' +
  'two people under one account never share a pool.';

/** Appended to the routes under this router that are keyed on the account instead. */
const ACCOUNT_SCOPED =
  '\n\n**Account-scoped, not profile-scoped.** `X-Active-Profile-Id` is still resolved and ' +
  'ownership-checked (a profile the account does not own answers 404 before the handler runs), ' +
  'but the record itself hangs off the account, so every profile on the account sees the same ' +
  'list. Do not present it as belonging to the selected family member.';

const ENTRY_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    metric_type: { type: 'string', example: 'weight' },
    value: { type: 'number' },
    unit: { type: 'string', nullable: true, example: 'kg' },
    notes: { type: 'string', nullable: true },
    recorded_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const HABIT_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'CUSTOM'] },
    target_count: { type: 'integer' },
    reminder_time: { type: 'string', nullable: true, example: '08:30' },
    category: { type: 'string', nullable: true },
    unit: { type: 'string', nullable: true },
    is_active: { type: 'boolean' },
    current_streak: { type: 'integer' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const CHECKIN_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    habit_id: { type: 'string', format: 'uuid' },
    value: { type: 'number', nullable: true },
    notes: { type: 'string', nullable: true },
    completed_at: { type: 'string', format: 'date-time' },
  },
};

const GOAL_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    target_value: { type: 'number', nullable: true },
    current_value: { type: 'number', nullable: true },
    unit: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'abandoned'] },
    start_date: { type: 'string', example: '2026-08-01' },
    target_date: { type: 'string', nullable: true, example: '2026-12-31' },
  },
};

const REVIEW_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    target_type: { type: 'string', example: 'PROVIDER' },
    target_id: { type: 'string', format: 'uuid' },
    rating: { type: 'integer', minimum: 1, maximum: 5 },
    title: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
    helpful_count: { type: 'integer' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const REMINDER_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    message: { type: 'string', nullable: true },
    reminder_type: { type: 'string', example: 'habit' },
    related_id: { type: 'string', format: 'uuid', nullable: true },
    scheduled_at: { type: 'string', format: 'date-time' },
    is_active: { type: 'boolean' },
  },
};

const deletedShape: OpenApiFragment = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
};

function paged(description: string, item: OpenApiFragment): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: item },
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
  };
}

/** Bodies the handler consumes but no route validator declares. */
function undeclaredBody(schema: OpenApiFragment, description: string): OpenApiFragment {
  return {
    required: true,
    description: describe(
      description,
      ' This route has no server-side body validation — a malformed body surfaces as a 500, not a 400.',
    ),
    content: { 'application/json': { schema } },
  };
}

export function createProgressRoutes(
  controller: ProgressController,
  profileService: ProfileService,
) {
  return (
    new Elysia({ prefix: '/progress' })
      // Health data: a revoked token must not survive a Redis outage here either.
      .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
      // Resolves X-Active-Profile-Id (or the account's self profile) and proves
      // the account owns it. store.activeProfileId is the subject of care.
      .use(profileContext(profileService))
      .use(
        auditLog({
          action: 'progress.access',
          resourceType: 'progress',
          purpose: 'care_delivery',
          sink: writePhiAccessLog,
        }),
      )

      .get('/dashboard', controller.getDashboard, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'Progress dashboard for the acting profile',
          description: describe(
            'One call for the home screen: recent metric entries, habit streaks, goal progress ' +
              'and earned achievements, already aggregated. Prefer it over fanning out to the ' +
              'individual list endpoints — every call here writes a PHI audit row, so a ' +
              'dashboard that polls five endpoints leaves five rows a compliance reviewer reads.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(),
          responses: {
            200: okDoc('Aggregated dashboard for the acting profile', {
              type: 'object',
              properties: {
                recentEntries: { type: 'array', items: ENTRY_SHAPE },
                habits: { type: 'array', items: HABIT_SHAPE },
                goals: { type: 'array', items: GOAL_SHAPE },
                achievements: { type: 'array', items: { type: 'object' } },
              },
            }),
            ...errorsFor('progress:read'),
          },
        },
      })

      .post('/entries', controller.createEntry, {
        beforeHandle: WRITE,
        body: documented(progressEntrySchema),
        detail: {
          tags: TAGS,
          summary: 'Log a health metric entry',
          description: describe(
            'Records one measurement — weight, blood pressure, glucose, whatever `metricType` ' +
              'names. `recordedAt` defaults to now, so back-dating is explicit. ' +
              '`progress:write` is held by the `user` role but **not** by `provider`: a ' +
              'provider may read a record, never write to it.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(),
          requestBody: bodyDoc(progressEntrySchema),
          responses: {
            201: okDoc('Entry recorded', ENTRY_SHAPE),
            400: validationError,
            ...errorsFor('progress:write'),
          },
        },
      })

      .get('/entries', controller.listEntries, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'List health metric entries',
          description: describe(
            'Filter by `type` to chart one metric. Paginated, newest first.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(
            {
              name: 'type',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'weight' },
              description: 'Restrict to one `metricType`',
            },
            ...dateRangeParams,
            ...pageParams,
          ),
          responses: {
            200: paged('Page of entries for the acting profile', ENTRY_SHAPE),
            ...errorsFor('progress:read'),
          },
        },
      })

      .delete('/entries/:id', controller.deleteEntry, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Delete a metric entry',
          description: describe(
            'Hard delete of one measurement. An entry belonging to a different profile — even ' +
              'another profile on the same account — answers 404.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Entry id')),
          responses: {
            200: okDoc('Entry deleted', deletedShape),
            ...errorsForResource('progress:write', 'entry'),
          },
        },
      })

      .post('/habits', controller.createHabit, {
        beforeHandle: WRITE,
        body: documented(habitSchema),
        detail: {
          tags: TAGS,
          summary: 'Create a habit',
          description: describe(
            'A repeating behaviour to check in against. `frequency: CUSTOM` is what ' +
              '`customDays` is for; `reminderTime` is `HH:mm` in the user’s own clock.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(),
          requestBody: bodyDoc(habitSchema),
          responses: {
            201: okDoc('Habit created', HABIT_SHAPE),
            400: validationError,
            ...errorsFor('progress:write'),
          },
        },
      })

      .get('/habits', controller.listHabits, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'List habits',
          description: describe(
            'Active habits only unless `includeInactive=true`. Streak counts come back on each ' +
              'row, so no second call is needed to render them.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params({
            name: 'includeInactive',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
            description: 'Pass the string `true` to include archived habits',
          }),
          responses: {
            200: okDoc('Habits for the acting profile', { type: 'array', items: HABIT_SHAPE }),
            ...errorsFor('progress:read'),
          },
        },
      })

      .put('/habits/:id', controller.updateHabit, {
        beforeHandle: WRITE,
        body: documented(updateHabitSchema),
        detail: {
          tags: TAGS,
          summary: 'Update a habit',
          description: describe(
            'Partial update — send only what changes. Set `isActive: false` to archive a habit ' +
              'without losing its history.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Habit id')),
          requestBody: bodyDoc(updateHabitSchema),
          responses: {
            200: okDoc('Habit after the update', HABIT_SHAPE),
            400: validationError,
            ...errorsForResource('progress:write', 'habit'),
          },
        },
      })

      .delete('/habits/:id', controller.deleteHabit, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Delete a habit',
          description: describe(
            'Removes the habit and its check-in history. Archive with `isActive: false` instead ' +
              'if the history matters.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Habit id')),
          responses: {
            200: okDoc('Habit deleted', deletedShape),
            ...errorsForResource('progress:write', 'habit'),
          },
        },
      })

      .post('/habits/:id/checkin', controller.habitCheckin, {
        beforeHandle: WRITE,
        body: documented(habitCheckinBodySchema),
        detail: {
          tags: TAGS,
          summary: 'Check in on a habit',
          description: describe(
            'Marks the habit done and advances the streak. Every field is optional, so a bare ' +
              '"I did it today" can send `{}`. Pass `date` to back-fill a missed day and ' +
              '`value` for habits that count something.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Habit id')),
          requestBody: bodyDoc(
            habitCheckinBodySchema,
            'Every field is optional — `{}` is a valid check-in.',
          ),
          responses: {
            201: okDoc('Check-in recorded', CHECKIN_SHAPE),
            400: validationError,
            ...errorsForResource('progress:write', 'habit'),
          },
        },
      })

      .get('/habits/:id/history', controller.getCheckinHistory, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'Habit check-in history',
          description: describe(
            'The check-ins behind a streak, for a calendar view. Defaults to 30 per page rather ' +
              'than 20.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(
            idPathParam('Habit id'),
            ...dateRangeParams,
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
              schema: { type: 'integer', minimum: 1, default: 30 },
            },
          ),
          responses: {
            200: paged('Page of check-ins', CHECKIN_SHAPE),
            ...errorsForResource('progress:read', 'habit'),
          },
        },
      })

      .get('/achievements', controller.listAchievements, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'List earned achievements',
          description: describe('Badges the account has earned.', ACCOUNT_SCOPED),
          ...bearer,
          ...params(),
          responses: {
            200: okDoc('Earned achievements', {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  code: { type: 'string' },
                  title: { type: 'string' },
                  earned_at: { type: 'string', format: 'date-time' },
                },
              },
            }),
            ...errorsFor('progress:read'),
          },
        },
      })

      .get('/trends', controller.getProgressTrends, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'Metric trends over time',
          description: describe(
            'Server-side aggregation of one metric into buckets — use this for charts instead ' +
              'of pulling every entry and grouping in the client.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(
            {
              name: 'type',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'weight' },
              description: 'Metric to aggregate',
            },
            ...dateRangeParams,
            {
              name: 'granularity',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['day', 'week', 'month'] },
              description: 'Bucket size',
            },
          ),
          responses: {
            200: okDoc('Bucketed trend series', {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  bucket: { type: 'string', example: '2026-08-01' },
                  average: { type: 'number' },
                  min: { type: 'number' },
                  max: { type: 'number' },
                  count: { type: 'integer' },
                },
              },
            }),
            ...errorsFor('progress:read'),
          },
        },
      })

      .post('/goals', controller.createGoal, {
        beforeHandle: WRITE,
        body: documented(createGoalSchema),
        detail: {
          tags: TAGS,
          summary: 'Create a health goal',
          description: describe(
            'A target to move toward, e.g. "reach 78 kg by December". Dates are `YYYY-MM-DD`. ' +
              'New goals start at status `pending`.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(),
          requestBody: bodyDoc(createGoalSchema),
          responses: {
            201: okDoc('Goal created', GOAL_SHAPE),
            400: validationError,
            ...errorsFor('progress:write'),
          },
        },
      })

      .get('/goals', controller.listGoals, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'List health goals',
          description: describe(
            'Paginated. Filter by `status` to show only what is live.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'abandoned'],
              },
            },
            ...pageParams,
          ),
          responses: {
            200: paged('Page of goals for the acting profile', GOAL_SHAPE),
            ...errorsFor('progress:read'),
          },
        },
      })

      .put('/goals/:id', controller.updateGoal, {
        beforeHandle: WRITE,
        body: documented(updateGoalSchema),
        detail: {
          tags: TAGS,
          summary: 'Update a goal',
          description: describe(
            'Partial update of the goal’s definition — title, target, dates, status. To record ' +
              'a new measurement against it use `PUT /progress/goals/{id}/progress` instead.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Goal id')),
          requestBody: bodyDoc(updateGoalSchema),
          responses: {
            200: okDoc('Goal after the update', GOAL_SHAPE),
            400: validationError,
            ...errorsForResource('progress:write', 'goal'),
          },
        },
      })

      .put('/goals/:id/progress', controller.updateGoalProgress, {
        beforeHandle: WRITE,
        body: documented(goalProgressSchema),
        detail: {
          tags: TAGS,
          summary: 'Record a new current value for a goal',
          description: describe(
            'Sets `currentValue`; the server decides whether that completes the goal. This is ' +
              'the only field the route accepts.',
            PROFILE_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Goal id')),
          requestBody: bodyDoc(goalProgressSchema),
          responses: {
            200: okDoc('Goal with its new current value', GOAL_SHAPE),
            400: validationError,
            ...errorsForResource('progress:write', 'goal'),
          },
        },
      })

      .post('/reviews', controller.createReview, {
        beforeHandle: WRITE,
        body: documented(reviewSchema),
        detail: {
          tags: TAGS,
          summary: 'Submit a review for a provider or program',
          description: describe(
            'One review per account per target; a second one answers 409.',
            ACCOUNT_SCOPED,
            '\n\n> **Known contract defect.** The handler stores `targetType` and `targetId`, ' +
              'neither of which this route’s validator declares — and Elysia replaces the body ' +
              'with the validator’s parsed output, dropping undeclared fields before the ' +
              'handler runs. The insert therefore reaches the database with both missing and ' +
              'fails as a **500**, while the declared `providerId` and `bookingId` are accepted ' +
              'and then discarded. This endpoint cannot succeed until the two schemas are ' +
              'reconciled; do not build against it yet.',
          ),
          ...bearer,
          ...params(),
          requestBody: bodyDoc(reviewSchema),
          responses: {
            201: okDoc('Review submitted, pending moderation', REVIEW_SHAPE),
            400: validationError,
            409: errorDoc('You have already reviewed this item', 'CONFLICT'),
            500: errorDoc(
              '`targetType`/`targetId` were stripped by the route validator and the insert failed — see the note above',
              'INTERNAL_ERROR',
            ),
            ...errorsFor('progress:write'),
          },
        },
      })

      .get('/reviews', controller.listReviews, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'Search reviews',
          description:
            'This route applies **no implicit scoping at all** — it filters purely on the query ' +
            'string, so with no `userId` it returns every account’s reviews, not the caller’s. ' +
            'Pass `userId` explicitly to show a user their own. Reviews are moderated public ' +
            'content rather than health data, but the route still sits behind the progress ' +
            'guards and the profile resolver.',
          ...bearer,
          ...params(
            {
              name: 'targetType',
              in: 'query',
              required: false,
              schema: { type: 'string', example: 'PROVIDER' },
            },
            {
              name: 'targetId',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'userId',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
              description: 'Filter to one reviewer — required if you want "my reviews"',
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
            },
            ...pageParams,
          ),
          responses: {
            200: paged('Page of reviews matching the filters', REVIEW_SHAPE),
            ...errorsFor('progress:read'),
          },
        },
      })

      .get('/reviews/provider/:providerId', controller.getProviderReviews, {
        beforeHandle: PROVIDER_READ,
        detail: {
          tags: TAGS,
          summary: 'All reviews for one provider',
          description:
            'The provider’s public reputation list. Guarded by `providers:read`, not ' +
            '`progress:read` — this is provider data, not the caller’s health record.',
          ...bearer,
          ...params(
            {
              name: 'providerId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Provider id',
            },
            ...pageParams,
          ),
          responses: {
            200: paged('Page of reviews for that provider', REVIEW_SHAPE),
            ...errorsFor('providers:read'),
          },
        },
      })

      .put('/reviews/:id', controller.updateReview, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Edit your own review',
          description: describe(
            'Only the review’s author can edit it — anybody else gets 404, not 403.',
            ACCOUNT_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Review id')),
          requestBody: undeclaredBody(
            {
              type: 'object',
              properties: {
                rating: { type: 'integer', minimum: 1, maximum: 5 },
                title: { type: 'string' },
                comment: { type: 'string' },
              },
            },
            'Partial update — send only what changes.',
          ),
          responses: {
            200: okDoc('Review after the update', REVIEW_SHAPE),
            ...errorsForResource('progress:write', 'review', 'account'),
          },
        },
      })

      .delete('/reviews/:id', controller.deleteReview, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Delete your own review',
          description: describe('Author only; anybody else gets 404.', ACCOUNT_SCOPED),
          ...bearer,
          ...params(idPathParam('Review id')),
          responses: {
            200: okDoc('Review deleted', deletedShape),
            ...errorsForResource('progress:write', 'review', 'account'),
          },
        },
      })

      .post('/reviews/:id/response', controller.createReviewResponse, {
        beforeHandle: PROVIDER_WRITE,
        detail: {
          tags: TAGS,
          summary: 'Answer a review (provider only)',
          description:
            'A provider’s public reply. Guarded by `providers:write`, which only the `provider` ' +
            'and `admin` roles hold. One response per review — a second answers 409.',
          ...bearer,
          ...params(idPathParam('Review id being answered')),
          requestBody: undeclaredBody(
            {
              type: 'object',
              required: ['responseText'],
              properties: { responseText: { type: 'string' } },
            },
            'The public reply text.',
          ),
          responses: {
            201: okDoc('Response published', {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                review_id: { type: 'string', format: 'uuid' },
                response_text: { type: 'string' },
                created_at: { type: 'string', format: 'date-time' },
              },
            }),
            409: errorDoc('This review already has a response', 'CONFLICT'),
            ...errorsForResource('providers:write', 'review', 'account'),
          },
        },
      })

      .post('/reviews/:id/helpful', controller.voteReviewHelpful, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Vote a review helpful',
          description:
            'Increments the review’s helpful count on behalf of the account. Answers **201**, ' +
            'not 200. There is no request body.',
          ...bearer,
          ...params(idPathParam('Review id')),
          responses: {
            201: okDoc('Vote recorded', {
              type: 'object',
              properties: {
                reviewId: { type: 'string', format: 'uuid' },
                helpfulCount: { type: 'integer' },
              },
            }),
            ...errorsForResource('progress:write', 'review', 'account'),
          },
        },
      })

      .post('/reminders', controller.createReminder, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Create a wellness reminder',
          description: describe(
            'A one-off nudge at `scheduledAt`. `relatedId` can point at the habit or goal it is ' +
              'about.',
            ACCOUNT_SCOPED,
          ),
          ...bearer,
          ...params(),
          requestBody: undeclaredBody(
            {
              type: 'object',
              required: ['title', 'reminderType', 'scheduledAt'],
              properties: {
                title: { type: 'string' },
                message: { type: 'string' },
                reminderType: { type: 'string', example: 'habit' },
                relatedId: { type: 'string', format: 'uuid' },
                scheduledAt: { type: 'string', format: 'date-time' },
              },
            },
            'What to remind the user about, and when.',
          ),
          responses: {
            201: okDoc('Reminder created', REMINDER_SHAPE),
            ...errorsFor('progress:write'),
          },
        },
      })

      .get('/reminders', controller.listReminders, {
        beforeHandle: READ,
        detail: {
          tags: TAGS,
          summary: 'List reminders',
          description: describe(
            'Paginated. `active=true` hides ones already fired or switched off.',
            ACCOUNT_SCOPED,
          ),
          ...bearer,
          ...params(
            {
              name: 'active',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'] },
              description: 'Pass the string `true` or `false`; omit for all',
            },
            ...pageParams,
          ),
          responses: {
            200: paged('Page of reminders', REMINDER_SHAPE),
            ...errorsFor('progress:read'),
          },
        },
      })

      .put('/reminders/:id', controller.updateReminder, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Update a reminder',
          description: describe(
            'Partial update. Set `isActive: false` to switch one off without deleting it.',
            ACCOUNT_SCOPED,
          ),
          ...bearer,
          ...params(idPathParam('Reminder id')),
          requestBody: undeclaredBody(
            {
              type: 'object',
              properties: {
                title: { type: 'string' },
                message: { type: 'string' },
                scheduledAt: { type: 'string', format: 'date-time' },
                isActive: { type: 'boolean' },
              },
            },
            'Partial update — send only what changes.',
          ),
          responses: {
            200: okDoc('Reminder after the update', REMINDER_SHAPE),
            ...errorsForResource('progress:write', 'reminder', 'account'),
          },
        },
      })

      .delete('/reminders/:id', controller.deleteReminder, {
        beforeHandle: WRITE,
        detail: {
          tags: TAGS,
          summary: 'Delete a reminder',
          description: describe('Removes the reminder outright.', ACCOUNT_SCOPED),
          ...bearer,
          ...params(idPathParam('Reminder id')),
          responses: {
            200: okDoc('Reminder deleted', deletedShape),
            ...errorsForResource('progress:write', 'reminder', 'account'),
          },
        },
      })
  );
}
