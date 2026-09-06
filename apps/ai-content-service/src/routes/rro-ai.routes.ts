import { auditLog, permissionGuard, requireAuth, verifyHmac } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import type { RroAiController } from '../controllers/rro-ai.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { classifyRequestSchema, summaryRequestSchema } from '../validators/index.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['rro-ai'];

const S2S = 'Service-to-service only — HMAC-signed, never proxied by the gateway.';

const hmacAuth: OpenApiFragment = {
  parameters: [
    {
      name: 'X-Service-Name',
      in: 'header',
      required: true,
      schema: { type: 'string', example: 'user-provider-service' },
      description: 'Calling service identifier',
    },
    {
      name: 'X-Timestamp',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description: 'Unix epoch milliseconds — must be within 30s of server time',
    },
    {
      name: 'X-Signature',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description: 'HMAC-SHA256 over the exact raw body',
    },
  ],
};

const CLASSIFICATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    intake_id: { type: 'string', format: 'uuid', nullable: true },
    intake_version: { type: 'integer', nullable: true },
    provider: {
      type: 'string',
      enum: ['bedrock', 'rules'],
      description:
        '`rules` is the deterministic baseline. Its confidence is capped below the transition floor, so its results are advisory and never move a profile.',
    },
    model_id: { type: 'string', nullable: true },
    contract_version: { type: 'string', example: 'v1' },
    prompt_version: { type: 'string', example: 'rro-2026-08-27.1' },
    state: {
      type: 'string',
      nullable: true,
      enum: ['intake', 'reverse', 'restore', 'optimise'],
      description: 'Null when the provider refused.',
    },
    confidence: { type: 'number', nullable: true, example: 0.62 },
    pillar_priorities: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['nutrition', 'movement', 'sleep', 'stress', 'environment'],
      },
    },
    rationale: { type: 'string', nullable: true },
    missing_data: { type: 'array', items: { type: 'string' } },
    refused_reason: {
      type: 'string',
      nullable: true,
      enum: ['insufficient_data', 'out_of_scope', 'safety_guardrail'],
    },
    refused_detail: { type: 'string', nullable: true },
    transitioned: { type: 'boolean', description: 'Whether this result moved the profile' },
    not_transitioned_reason: {
      type: 'string',
      nullable: true,
      enum: [
        'refused',
        'low_confidence',
        'already_in_state',
        'invalid_transition',
        'transition_failed',
      ],
    },
    latency_ms: { type: 'integer', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const SUMMARY_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    intake_version: { type: 'integer', nullable: true },
    provider: { type: 'string', enum: ['bedrock', 'rules'] },
    current_state: {
      type: 'string',
      nullable: true,
      enum: ['intake', 'reverse', 'restore', 'optimise'],
    },
    concerns: { type: 'array', items: { type: 'string' } },
    missing_data: { type: 'array', items: { type: 'string' } },
    red_flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string' },
          severity: { type: 'string', enum: ['routine', 'urgent', 'emergency'] },
          basis: { type: 'string' },
        },
      },
    },
    suggested_questions: { type: 'array', items: { type: 'string' } },
    sufficient_data: {
      type: 'boolean',
      description:
        'False means the provider declined for lack of input. Never render a declined summary as a clinical finding.',
    },
    stale: {
      type: 'boolean',
      description: 'True when the intake has been resubmitted since this summary was generated.',
    },
    generated_at: { type: 'string', format: 'date-time' },
  },
};

const aiErrors: OpenApiFragment = {
  404: errorDoc('No profile, or no intake to work from', 'NOT_FOUND'),
  502: errorDoc(
    'The provider returned output that does not fit the contract. Nothing was stored — a classification that does not parse is never coerced into one that does.',
    'AI_INVALID_RESPONSE',
  ),
  503: errorDoc(
    'The model is unavailable. There is deliberately no fabricated fallback on this path.',
    'SERVICE_UNAVAILABLE',
  ),
};

/**
 * Generating is HMAC-only: it costs a model call and it can move a profile
 * through the care pathway. Reading a stored result is account-scoped.
 */
export function createRroAiRoutes(controller: RroAiController) {
  const internal = new Elysia({ prefix: '/internal/ai' })
    .use(verifyHmac(config.HMAC_SECRET))
    .post('/classify', controller.classify, {
      body: documented(classifyRequestSchema),
      detail: {
        tags: TAGS,
        summary: 'Classify a profile’s RRO state from its latest intake',
        description: `${S2S} Reads the profile's latest intake, asks the configured provider, and validates the answer against the shared contract before storing it. Output that does not fit is a 502 and is never stored.\n\nA result transitions the profile only if all three hold: the provider did not refuse, confidence is at or above 0.7, and the taxonomy permits the move (care advances, holds or falls back one step — it cannot skip). Anything else is stored with \`transitioned: false\` and the reason, because a refused attempt is still evidence.\n\nThe intake is read from storage rather than passed in, so a caller cannot classify one set of answers and have the result stored against another profile.`,
        ...hmacAuth,
        requestBody: bodyDoc(classifyRequestSchema),
        responses: {
          200: okDoc('Classification stored', CLASSIFICATION_SHAPE, {
            profile_id: 'df864dbd-4eb5-4785-8299-28bb09a69246',
            provider: 'rules',
            state: 'reverse',
            confidence: 0.62,
            transitioned: false,
            not_transitioned_reason: 'low_confidence',
          }),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: errorDoc('Missing, expired or invalid HMAC signature', 'UNAUTHORIZED'),
          ...aiErrors,
        },
      },
    })
    .post('/summary', controller.summarise, {
      body: documented(summaryRequestSchema),
      detail: {
        tags: TAGS,
        summary: 'Generate a pre-consult summary for a profile',
        description: `${S2S} Produces concerns, missing data, red flags and suggested questions from the profile's latest intake, and stores them with the intake version they were derived from so the clinician workspace can read them without paying for the model again.\n\nA provider that declines for lack of input is stored as \`sufficient_data: false\`. That is a refusal, not a finding, and must never be rendered as one.`,
        ...hmacAuth,
        requestBody: bodyDoc(summaryRequestSchema),
        responses: {
          200: okDoc('Summary stored', SUMMARY_SHAPE),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: errorDoc('Missing, expired or invalid HMAC signature', 'UNAUTHORIZED'),
          ...aiErrors,
        },
      },
    });

  const reads = new Elysia({ prefix: '/rro' })
    .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
    .use(
      auditLog({
        action: 'rro.ai.read',
        resourceType: 'rro_ai',
        purpose: 'care_delivery',
        sink: writePhiAccessLog,
      }),
    )
    .get('/:profileId/classification', controller.getClassification, {
      beforeHandle: permissionGuard('rro:read'),
      detail: {
        tags: TAGS,
        summary: 'Latest stored classification for a profile',
        description:
          'Returns the most recent classification, including one that refused or did not transition. The profile is ownership-checked; another account’s profile answers 404.',
        ...bearer,
        responses: {
          200: okDoc('Latest classification', CLASSIFICATION_SHAPE),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
          404: errorDoc('No such profile, or no classification yet', 'NOT_FOUND'),
        },
      },
    })
    .get('/:profileId/summary', controller.getSummary, {
      beforeHandle: permissionGuard('rro:read'),
      detail: {
        tags: TAGS,
        summary: 'Latest stored pre-consult summary for a profile',
        description:
          '`stale` is true when the intake has been resubmitted since the summary was generated — the answers it describes are no longer the current ones.',
        ...bearer,
        responses: {
          200: okDoc('Latest summary', SUMMARY_SHAPE),
          401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
          403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
          404: errorDoc('No such profile, or no summary yet', 'NOT_FOUND'),
        },
      },
    });

  return new Elysia().use(internal).use(reads);
}
