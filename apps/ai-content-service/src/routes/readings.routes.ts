import { auditLog, permissionGuard, rateLimit, requireAuth } from '@longeny/middleware';
import { correctReadingSchema, submitReadingsSchema } from '@longeny/validators';
import { Elysia, t } from 'elysia';
import type { ReadingsController } from '../controllers/readings.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['readings'];

const READING_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    document_id: { type: 'string', format: 'uuid', description: 'The report it came from' },
    marker_code: { type: 'string', example: 'hba1c' },
    value: { type: 'number', example: 5.4 },
    unit: { type: 'string', example: '%' },
    measured_at: {
      type: 'string',
      format: 'date-time',
      description: 'When the sample was taken; defaults to the report date',
    },
    entry_method: { type: 'string', enum: ['manual', 'extracted'] },
    supersedes_id: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: 'The reading this one corrects',
    },
    superseded_by: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: 'The correction that replaced this reading',
    },
    current: {
      type: 'boolean',
      description:
        'False once a correction has replaced it. Only current readings are benchmarked.',
    },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const READING_EXAMPLE = {
  id: '5b1d0f3e-8c55-4d44-9a55-0b6f2f1c7a10',
  profile_id: 'df864dbd-4eb5-4785-8299-28bb09a69246',
  document_id: '0e7c8f5d-3a2b-4c1d-9e8f-7a6b5c4d3e2f',
  marker_code: 'hba1c',
  value: 5.4,
  unit: '%',
  measured_at: '2026-09-01T08:30:00.000Z',
  entry_method: 'manual',
  supersedes_id: null,
  superseded_by: null,
  current: true,
  created_at: '2026-09-03T10:12:44.000Z',
};

const accessErrors: OpenApiFragment = {
  401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
  403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
  404: errorDoc(
    'No such report, a deleted one, or one this caller may not see — deliberately indistinguishable',
    'NOT_FOUND',
  ),
  503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
};

/**
 * Readings (Week 8, V-W8-2) — the values inside a lab report.
 */
export function createReadingsRoutes(controller: ReadingsController) {
  const audit = auditLog({
    action: 'readings.access',
    resourceType: 'biomarker',
    purpose: 'care_delivery',
    sink: writePhiAccessLog,
  });
  // Per account: a family entering a panel sends one request per report, so
  // this only ever bites a script.
  const writeLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'readings', by: 'account' });

  const onReports = new Elysia({ prefix: '/reports' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(audit)
    .use(writeLimit)
    .post('/:documentId/readings', controller.submit, {
      beforeHandle: permissionGuard('documents:write'),
      params: t.Object({ documentId: t.String({ format: 'uuid' }) }),
      body: documented(submitReadingsSchema, {
        readings: [
          { markerCode: 'hba1c', value: 5.4, unit: '%' },
          { markerCode: 'ldl_c', value: 118, unit: 'mg/dL', measuredAt: '2026-09-01T08:30:00Z' },
        ],
      }),
      detail: {
        tags: TAGS,
        summary: 'Enter the values from a lab report',
        description:
          'Stores one reading per marker, all or nothing. The subject of care is the profile the report belongs to — it is not taken from the request.\n\n- Only `lab_report` documents take readings; any other type answers 400.\n- `measuredAt` defaults to the report date, not today.\n- The same marker twice in one submission is refused: there is no telling which is right.\n- Units are stored as written and never converted. A reading whose unit differs from its reference range is benchmarked as `unit_mismatch`.\n- A wrong value is not edited. Correct it with `POST /readings/{id}/corrections`.\n\nOnly the account that owns the profile may enter readings.',
        ...bearer,
        requestBody: bodyDoc(submitReadingsSchema),
        responses: {
          201: okDoc('Readings stored', { type: 'array', items: READING_SHAPE }, [READING_EXAMPLE]),
          400: errorDoc(
            'Body failed validation, the same marker appears twice, or the document is not a lab report',
            'VALIDATION_ERROR',
          ),
          429: errorDoc('Too many writes for this account', 'RATE_LIMITED'),
          ...accessErrors,
        },
      },
    })
    .get('/:documentId/readings', controller.list, {
      beforeHandle: permissionGuard('documents:read'),
      params: t.Object({ documentId: t.String({ format: 'uuid' }) }),
      detail: {
        tags: TAGS,
        summary: 'Readings on a report, corrections included',
        description:
          'Every reading ever entered against the report, ordered by marker then entry time. A corrected reading stays in the list with `current: false` and `superseded_by` pointing at its replacement, so the history of a value is visible.\n\nRead by the owning account, or by a provider with an active booking.',
        ...bearer,
        responses: {
          200: okDoc('Readings', { type: 'array', items: READING_SHAPE }, [READING_EXAMPLE]),
          400: errorDoc('Document id is not a UUID', 'VALIDATION_ERROR'),
          ...accessErrors,
        },
      },
    });

  const onReadings = new Elysia({ prefix: '/readings' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(audit)
    .use(writeLimit)
    .post('/:readingId/corrections', controller.correct, {
      beforeHandle: permissionGuard('documents:write'),
      params: t.Object({ readingId: t.String({ format: 'uuid' }) }),
      body: documented(correctReadingSchema, { value: 5.4, unit: '%' }),
      detail: {
        tags: TAGS,
        summary: 'Correct a reading',
        description:
          'Writes a new reading that replaces this one. The original is kept, marked `current: false`, so anything computed from it can still be explained. The marker cannot change — a value entered under the wrong marker is a different mistake.\n\nOnly the current reading can be corrected: correcting one that was already replaced answers 409.',
        ...bearer,
        requestBody: bodyDoc(correctReadingSchema),
        responses: {
          201: okDoc('The correction', READING_SHAPE, {
            ...READING_EXAMPLE,
            supersedes_id: '3a9e2c71-1f0b-4c8e-bf2d-7d6a5e4c3b2a',
          }),
          400: errorDoc('Body failed validation', 'VALIDATION_ERROR'),
          409: errorDoc('The reading was already corrected', 'READING_SUPERSEDED'),
          429: errorDoc('Too many writes for this account', 'RATE_LIMITED'),
          ...accessErrors,
        },
      },
    });

  return new Elysia().use(onReports).use(onReadings);
}
