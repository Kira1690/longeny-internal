import {
  auditLog,
  permissionGuard,
  rateLimit,
  remoteProfileContext,
  requireAuth,
} from '@longeny/middleware';
import { submitIntakeSchema } from '@longeny/validators';
import { Elysia, t } from 'elysia';
import { config } from '../config/index.js';
import type { IntakeController } from '../controllers/intake.controller.js';
import { writePhiAccessLog } from '../services/phi-audit.service.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['intake'];

const activeProfileHeader: OpenApiFragment = {
  name: 'X-Active-Profile-Id',
  in: 'header',
  required: false,
  schema: { type: 'string', format: 'uuid' },
  description:
    'Profile to act as. Omit to act as the account owner’s own `self` profile. Ownership is re-checked on every request; a profile the account does not own answers 404.',
};

const INTAKE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    profile_id: { type: 'string', format: 'uuid' },
    version: { type: 'integer', description: 'Increments per submission; earlier versions stay' },
    symptoms: { type: 'array', items: { type: 'string' } },
    goals: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    medications: { type: 'array', items: { type: 'string' } },
    pillar_priorities: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['nutrition', 'movement', 'sleep', 'stress', 'environment'],
      },
    },
    notes: { type: 'string', nullable: true },
    submitted_at: { type: 'string', format: 'date-time' },
  },
};

const INTAKE_EXAMPLE = {
  id: '7c2a4d61-2f2e-4a09-8f3f-9d1a1c6c1f11',
  profile_id: 'df864dbd-4eb5-4785-8299-28bb09a69246',
  version: 2,
  symptoms: ['fatigue in the afternoon', 'joint stiffness on waking'],
  goals: ['reverse prediabetes', 'sleep through the night'],
  conditions: ['prediabetes'],
  medications: ['metformin 500mg'],
  pillar_priorities: ['nutrition', 'sleep'],
  notes: null,
  submitted_at: '2026-08-27T09:14:22.000Z',
};

const ownershipErrors: OpenApiFragment = {
  401: errorDoc('Missing or invalid token', 'UNAUTHORIZED'),
  403: errorDoc('Token lacks the required permission', 'FORBIDDEN'),
  404: errorDoc(
    'No such profile, or the profile belongs to another account — deliberately indistinguishable',
    'NOT_FOUND',
  ),
  503: errorDoc('Profile ownership could not be verified', 'SERVICE_UNAVAILABLE'),
};

/**
 * RRO intake.
 *
 * The subject of care comes from the resolved profile context, never from the
 * body: a body-supplied profile id would be a scope the client chooses for
 * itself.
 */
export function createIntakeRoutes(controller: IntakeController) {
  return (
    new Elysia({ prefix: '/intake' })
      // Health data: a revoked token must not be honoured because Redis is down.
      .use(requireAuth({ onRevocationCheckFailure: 'closed' }))
      // Profiles live in another service's database — ownership is asked there.
      .use(
        remoteProfileContext({
          serviceName: 'ai-content-service',
          userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
          hmacSecret: config.HMAC_SECRET,
        }),
      )
      // Every request here — including denials — lands in phi_access_log.
      .use(
        auditLog({
          action: 'intake.access',
          resourceType: 'intake',
          purpose: 'care_delivery',
          sink: writePhiAccessLog,
        }),
      )
      // Per account, not per IP: this is the input to a paid model call, and a
      // family behind one address must not exhaust a shared budget.
      .use(
        rateLimit({
          windowMs: 60_000,
          max: 60,
          keyPrefix: 'intake',
          by: 'account',
        }),
      )

      .post('', controller.submit, {
        beforeHandle: permissionGuard('intake:write'),
        body: documented(submitIntakeSchema),
        detail: {
          tags: TAGS,
          summary: 'Submit RRO intake for the active profile',
          description:
            'Stores a new intake **version** for the profile this request is acting as. Submissions are never updated in place: a stored AI classification points at the version it was derived from, so overwriting the answers would leave a clinical decision with no visible input. Resubmitting writes version n+1 and leaves n where it is.',
          ...bearer,
          parameters: [activeProfileHeader],
          requestBody: bodyDoc(submitIntakeSchema),
          responses: {
            201: okDoc('Intake stored as a new version', INTAKE_SHAPE, INTAKE_EXAMPLE),
            400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
            429: errorDoc('Too many submissions for this account', 'RATE_LIMITED'),
            ...ownershipErrors,
          },
        },
      })

      .get('/:profileId', controller.get, {
        beforeHandle: permissionGuard('intake:read'),
        query: t.Object({
          version: t.Optional(t.String({ description: 'Specific version; omit for the latest' })),
        }),
        detail: {
          tags: TAGS,
          summary: 'Read saved intake for a profile',
          description:
            'Returns the latest intake for the profile, or the version named by `?version=`. The profile is named in the path, so ownership is checked here rather than from the header.',
          ...bearer,
          responses: {
            200: okDoc('The stored intake', INTAKE_SHAPE, INTAKE_EXAMPLE),
            ...ownershipErrors,
          },
        },
      })

      .get('/:profileId/history', controller.history, {
        beforeHandle: permissionGuard('intake:read'),
        detail: {
          tags: TAGS,
          summary: 'List intake versions for a profile',
          description:
            'Version numbers and submission times only — the answers themselves come from `GET /intake/{profileId}?version=`.',
          ...bearer,
          responses: {
            200: okDoc(
              'Versions, newest first',
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    version: { type: 'integer' },
                    submitted_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
              [{ id: INTAKE_EXAMPLE.id, version: 2, submitted_at: INTAKE_EXAMPLE.submitted_at }],
            ),
            ...ownershipErrors,
          },
        },
      })
  );
}
