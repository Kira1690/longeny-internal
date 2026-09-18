import { auditLog, permissionGuard, requireAuth } from '@longeny/middleware';
import { BENCHMARK_STATUSES, NO_REFERENCE_REASONS, RANGE_SEXES, RRO_PILLARS } from '@longeny/types';
import { Elysia, t } from 'elysia';
import type { BenchmarkController } from '../controllers/benchmark.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['benchmarks'];

const MARKER_CODE = '^[a-z][a-z0-9_]*$';

const RANGE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    marker_code: { type: 'string', example: 'hba1c' },
    marker_name: { type: 'string', example: 'HbA1c' },
    unit: { type: 'string', example: '%' },
    sex: { type: 'string', enum: [...RANGE_SEXES] },
    age_min_years: { type: 'integer', nullable: true },
    age_max_years: { type: 'integer', nullable: true },
    normal_low: { type: 'number', nullable: true },
    normal_high: { type: 'number', nullable: true },
    optimal_low: { type: 'number', nullable: true },
    optimal_high: { type: 'number', nullable: true },
    pillar: { type: 'string', enum: [...RRO_PILLARS], nullable: true },
    source: { type: 'string', description: 'Lab or guideline body the range comes from' },
    provisional: {
      type: 'boolean',
      description:
        'True for a placeholder range that has not been clinically reviewed. Anything judged against it is not a clinical result.',
    },
  },
};

const BENCHMARK_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    marker_code: { type: 'string', example: 'hba1c' },
    marker_name: { type: 'string', nullable: true },
    status: {
      type: 'string',
      enum: [...BENCHMARK_STATUSES],
      description:
        '`no_reference` when there is nothing to compare against, `unit_mismatch` when the reading and the range use different units. Values are never converted and a missing range is never guessed.',
    },
    reason: {
      type: 'string',
      enum: [...NO_REFERENCE_REASONS],
      nullable: true,
      description: 'Why there is no reference. Set only with `no_reference`.',
    },
    provisional: {
      type: 'boolean',
      description: 'True when judged against a placeholder range.',
    },
    reading: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        value: { type: 'number' },
        unit: { type: 'string' },
        measured_at: { type: 'string', format: 'date-time' },
        document_id: { type: 'string', format: 'uuid', description: 'The report it came from' },
        entry_method: { type: 'string', enum: ['manual', 'extracted'] },
      },
    },
    range: { ...RANGE_SHAPE, nullable: true },
  },
};

const TREND_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    marker_code: { type: 'string', example: 'hba1c' },
    marker_name: { type: 'string', nullable: true },
    unit: { type: 'string', nullable: true },
    direction: { type: 'string', enum: ['rising', 'falling', 'flat'], nullable: true },
    change: { type: 'number', nullable: true, description: 'Latest minus previous' },
    change_percent: { type: 'number', nullable: true },
    toward_range: {
      type: 'string',
      enum: ['improving', 'worsening', 'unchanged'],
      nullable: true,
    },
    provisional: { type: 'boolean' },
    excluded_for_unit: { type: 'integer' },
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reading_id: { type: 'string', format: 'uuid' },
          value: { type: 'number' },
          measured_at: { type: 'string', format: 'date-time' },
          document_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: [...BENCHMARK_STATUSES] },
        },
      },
    },
    range: { ...RANGE_SHAPE, nullable: true },
  },
};

const SCORE_RULES =
  '**Advisory only.** A score never moves a profile between care stages; that decision stays with a clinician.\n\nEach pillar scores 0–100 from the verdicts on its markers; the overall score is a weighted average of the pillars that have data. A pillar with no scorable readings is null and left out of the overall — missing labs are not bad labs. Readings with no reference, a unit mismatch or no pillar are listed under `unscored` with the reason.\n\n**Provisional.** The points per verdict and the pillar weights are placeholders until clinically decided, so every score is currently `provisional: true`. `scoring_version` names the rule set; a score computed under older rules keeps its version.';

const CONTRIBUTION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    reading_id: { type: 'string', format: 'uuid' },
    marker_code: { type: 'string' },
    value: { type: 'number' },
    status: { type: 'string', enum: [...BENCHMARK_STATUSES] },
    range_id: { type: 'string', format: 'uuid', nullable: true },
    points: { type: 'number', nullable: true },
    excluded_reason: {
      type: 'string',
      enum: ['no_reference', 'unit_mismatch', 'no_pillar'],
      nullable: true,
    },
  },
};

const SCORE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    scoring_version: { type: 'string', example: 'placeholder-2026-09.1' },
    overall: { type: 'number', nullable: true, example: 71.5 },
    pillars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pillar: { type: 'string', enum: [...RRO_PILLARS] },
          score: { type: 'number', nullable: true },
          scored_markers: { type: 'integer' },
          contributions: { type: 'array', items: CONTRIBUTION_SHAPE },
        },
      },
    },
    unscored: { type: 'array', items: CONTRIBUTION_SHAPE },
    provisional: { type: 'boolean' },
    advisory: { type: 'boolean', enum: [true] },
    computed_at: { type: 'string', format: 'date-time' },
    stale: { type: 'boolean' },
  },
};

const scoreErrors: OpenApiFragment = {
  400: errorDoc('Profile id is not a UUID', 'VALIDATION_ERROR'),
  401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
  403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
  404: errorDoc(
    'No such profile, not this account’s profile, or no active booking for this provider',
    'NOT_FOUND',
  ),
  503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
};

const BENCHMARK_EXAMPLE = [
  {
    marker_code: 'hba1c',
    marker_name: 'HbA1c',
    status: 'normal',
    reason: null,
    provisional: true,
    reading: {
      id: '5b1d0f3e-8c55-4d44-9a55-0b6f2f1c7a10',
      value: 5.4,
      unit: '%',
      measured_at: '2026-09-01T08:30:00.000Z',
      document_id: '0e7c8f5d-3a2b-4c1d-9e8f-7a6b5c4d3e2f',
      entry_method: 'manual',
    },
    range: {
      id: '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f',
      marker_code: 'hba1c',
      marker_name: 'HbA1c',
      unit: '%',
      sex: 'any',
      age_min_years: null,
      age_max_years: null,
      normal_low: 4,
      normal_high: 5.6,
      optimal_low: 4.5,
      optimal_high: 5.2,
      pillar: 'nutrition',
      source: 'PLACEHOLDER — not clinically reviewed',
      provisional: true,
    },
  },
];

/**
 * Benchmarks (Week 8, V-W8-3).
 *
 * `/profiles/:id/benchmarks` is served here while the rest of `/profiles` is
 * user-provider's; the gateway routes this one path to ai-content, as it does
 * the reports timeline.
 */
export function createBenchmarkRoutes(controller: BenchmarkController) {
  const profileBenchmarks = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    // Lab values are PHI: reads and refusals are both recorded.
    .use(
      auditLog({
        action: 'benchmarks.read',
        resourceType: 'biomarker',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .get('/:profileId/benchmarks', controller.forProfile, {
      beforeHandle: permissionGuard('documents:read'),
      params: t.Object({ profileId: t.String({ format: 'uuid' }) }),
      detail: {
        tags: TAGS,
        summary: 'Current readings for a profile, each judged against its reference range',
        description:
          'One entry per marker: the newest reading that no correction has replaced, from a report that still exists, and the verdict against the range that applies.\n\n**Provisional ranges.** Until clinically reviewed ranges are supplied, ranges are placeholders and every verdict against one carries `provisional: true`. `meta.provisional` is true when any entry is. A client must not present a provisional verdict as a clinical result.\n\n**Demographics.** Sex and age are not yet available to this service, so only ranges that apply to everyone are used. A marker whose ranges are all sex- or age-specific answers `no_reference` with `reason: needs_demographics`; `meta.demographics` is `unavailable`.\n\nRead by the owning account, or by a provider with an active booking. Anyone else gets 404.',
        ...bearer,
        responses: {
          200: okDoc(
            'Benchmarks, one per marker',
            { type: 'array', items: BENCHMARK_SHAPE },
            BENCHMARK_EXAMPLE,
          ),
          400: errorDoc('Profile id is not a UUID', 'VALIDATION_ERROR'),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
          404: errorDoc(
            'No such profile, not this account’s profile, or no active booking for this provider',
            'NOT_FOUND',
          ),
          503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
        },
      },
    });

  const profileTrends = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'trends.read',
        resourceType: 'biomarker',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .get('/:profileId/trends', controller.trends, {
      beforeHandle: permissionGuard('documents:read'),
      params: t.Object({ profileId: t.String({ format: 'uuid' }) }),
      query: t.Object({
        marker: t.Optional(
          t.String({
            pattern: MARKER_CODE,
            maxLength: 64,
            description: 'One marker code; omit for every marker the profile has readings for',
          }),
        ),
      }),
      detail: {
        tags: TAGS,
        summary: 'Direction of travel per marker',
        description:
          'Every current reading per marker, oldest sample first, each with its own verdict so a chart can colour it.\n\n- `direction` is arithmetic: `rising`, `falling` or `flat`, comparing the latest two samples. Null with fewer than two.\n- `toward_range` says whether the latest move went towards the target band (the optimal band, or the normal band when there is no optimal one): `improving`, `worsening` or `unchanged`. Null when there is no usable range — rising is good for some markers and bad for others, and it is never guessed.\n- Samples in a different unit from the newest one are left out and counted in `excluded_for_unit`; values are never converted.\n- `provisional` is true when `toward_range` was judged against a placeholder range.\n\nRead by the owning account, or by a provider with an active booking.',
        ...bearer,
        responses: {
          200: okDoc('Trends, one per marker', { type: 'array', items: TREND_SHAPE }),
          400: errorDoc('Profile id or marker code is malformed', 'VALIDATION_ERROR'),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
          404: errorDoc(
            'No such profile, not this account’s profile, or no active booking for this provider',
            'NOT_FOUND',
          ),
          503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
        },
      },
    });

  const profileScores = new Elysia({ prefix: '/profiles' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'scores.access',
        resourceType: 'rro_score',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .post('/:profileId/scores', controller.computeScore, {
      beforeHandle: permissionGuard('documents:read'),
      params: t.Object({ profileId: t.String({ format: 'uuid' }) }),
      detail: {
        tags: TAGS,
        summary: 'Compute the pillar and overall RRO score now',
        description: `${SCORE_RULES}\n\nStores the result so it can be shown again exactly as computed. If nothing has changed since the last score, that score is returned (200, \`meta.reused: true\`) rather than a duplicate stored; otherwise a new one is stored (201).`,
        ...bearer,
        responses: {
          200: okDoc('Nothing changed — the previous score', SCORE_SHAPE),
          201: okDoc('A new score', SCORE_SHAPE),
          ...scoreErrors,
        },
      },
    })
    .get('/:profileId/scores', controller.latestScore, {
      beforeHandle: permissionGuard('documents:read'),
      params: t.Object({ profileId: t.String({ format: 'uuid' }) }),
      detail: {
        tags: TAGS,
        summary: 'The most recent stored score',
        description: `${SCORE_RULES}\n\n\`stale: true\` means the readings, the ranges or the scoring rules have changed since it was computed; \`POST\` to compute a fresh one.`,
        ...bearer,
        responses: {
          200: okDoc('Latest score', SCORE_SHAPE),
          ...scoreErrors,
          404: errorDoc(
            'No such profile, not readable by this caller, or no score yet',
            'NOT_FOUND',
          ),
        },
      },
    });

  const ranges = new Elysia({ prefix: '/reference-ranges' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .get('', controller.referenceRanges, {
      beforeHandle: permissionGuard('documents:read'),
      query: t.Object({
        marker: t.Optional(
          t.String({
            pattern: MARKER_CODE,
            maxLength: 64,
            description: 'One marker code, e.g. `hba1c`',
          }),
        ),
      }),
      detail: {
        tags: TAGS,
        summary: 'Reference ranges currently in force',
        description:
          'Every range a benchmark can be judged against, with the source it comes from. Retired ranges are not listed. `provisional: true` marks a placeholder that has not been clinically reviewed.',
        ...bearer,
        responses: {
          200: okDoc('Ranges', { type: 'array', items: RANGE_SHAPE }),
          400: errorDoc('`marker` is not a valid marker code', 'VALIDATION_ERROR'),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
        },
      },
    });

  return new Elysia().use(profileBenchmarks).use(profileTrends).use(profileScores).use(ranges);
}
