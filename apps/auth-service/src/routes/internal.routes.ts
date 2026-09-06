import { verifyHmac } from '@longeny/middleware';
import Elysia from 'elysia';
import { config } from '../config/index.js';
import {
  handleGdprDelete,
  handleGdprExport,
  handleInternalGetConsents,
  handleInternalVerify,
} from '../controllers/internal.controller.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const TAGS = ['Internal'];

/**
 * HMAC-signed service-to-service calls. No `security` block, because a bearer
 * token alone is never enough here — the gateway does not expose `/internal/*`
 * to the browser at all.
 */
const hmacHeaders: OpenApiFragment[] = [
  {
    name: 'X-Service-Name',
    in: 'header',
    required: true,
    schema: { type: 'string', example: 'user-provider-service' },
    description: 'Calling service’s name',
  },
  {
    name: 'X-Timestamp',
    in: 'header',
    required: true,
    schema: { type: 'string', example: '1787000000000' },
    description: 'Epoch milliseconds. Requests more than 30 s old are refused as replays.',
  },
  {
    name: 'X-Signature',
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'HMAC over method, path, timestamp and raw body with the shared secret',
  },
];

const hmacErrors: OpenApiFragment = {
  401: errorDoc(
    'Missing HMAC headers, a timestamp outside the 30-second window, or a signature that did not verify',
    'UNAUTHORIZED',
  ),
};

const internalRoutes = new Elysia({ prefix: '/internal' })
  .use(verifyHmac(config.HMAC_SECRET))

  .get('/auth/verify', handleInternalVerify, {
    detail: {
      tags: TAGS,
      summary: 'Verify a user access token on behalf of another service',
      description:
        'Doubly authenticated: the *call* is HMAC-signed by the calling service, and the *token* ' +
        'being checked is passed in the `Authorization` header of that same request. Returns the ' +
        'decoded payload, including `permissions`, and refuses a blacklisted token.',
      parameters: [
        ...hmacHeaders,
        {
          name: 'Authorization',
          in: 'header',
          required: true,
          schema: { type: 'string', example: 'Bearer <user access token>' },
          description: 'The end user’s access token to verify — not a service credential',
        },
      ],
      responses: {
        200: okDoc('Token is valid; decoded payload returned', {
          type: 'object',
          properties: {
            sub: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string' },
            permissions: { type: 'array', items: { type: 'string' } },
            iat: { type: 'integer' },
            exp: { type: 'integer' },
          },
        }),
        401: errorDoc(
          'HMAC verification failed, the `Authorization` header is missing, or the token is invalid, expired or blacklisted',
          'INVALID_TOKEN',
        ),
      },
    },
  })

  .get('/auth/consents/:userId', handleInternalGetConsents, {
    detail: {
      tags: TAGS,
      summary: 'Active consents for a user',
      description:
        'Used by other services to decide whether a kind of processing is permitted (health data, ' +
        'AI profiling, sharing with providers). Only currently-granted consents come back; a user ' +
        'with none answers 200 with an empty array, never 404.',
      parameters: [
        ...hmacHeaders,
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Credential id of the user',
        },
      ],
      responses: {
        200: okDoc('Currently granted consents', {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              consent_type: { type: 'string' },
              version: { type: 'string' },
              granted_at: { type: 'string', format: 'date-time' },
            },
          },
        }),
        ...hmacErrors,
      },
    },
  })

  .get('/gdpr/user-data/:credentialId', handleGdprExport, {
    detail: {
      tags: TAGS,
      summary: 'Export a credential’s auth records (DSAR)',
      description:
        'Credential row, sessions, linked OAuth accounts, consents and audit entries, for a ' +
        'data-subject access request assembled by the user service. Password hashes are never ' +
        'included. An unknown credential answers **200 with `data: null`**, not 404.',
      parameters: [
        ...hmacHeaders,
        {
          name: 'credentialId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Credential id to export',
        },
      ],
      responses: {
        200: okDoc('Auth records for the credential, or `null` if unknown', {
          type: 'object',
          nullable: true,
          properties: {
            credential: { type: 'object' },
            sessions: { type: 'array', items: { type: 'object' } },
            oauthAccounts: { type: 'array', items: { type: 'object' } },
            consents: { type: 'array', items: { type: 'object' } },
          },
        }),
        ...hmacErrors,
      },
    },
  })

  .delete('/gdpr/user-data/:credentialId', handleGdprDelete, {
    detail: {
      tags: TAGS,
      summary: 'Erase a credential (GDPR erasure)',
      description:
        'Removes the credential and everything hanging off it. Idempotent, and deliberately not ' +
        'an error when there is nothing to erase: an unknown credential answers 200 with ' +
        '`deleted: false`.',
      parameters: [
        ...hmacHeaders,
        {
          name: 'credentialId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Credential id to erase',
        },
      ],
      responses: {
        200: okDoc(
          'Erasure completed, or nothing to erase',
          {
            type: 'object',
            properties: {
              message: { type: 'string' },
              deleted: { type: 'boolean' },
            },
          },
          { message: 'No data found for this credential', deleted: false },
        ),
        ...hmacErrors,
      },
    },
  });

export default internalRoutes;
