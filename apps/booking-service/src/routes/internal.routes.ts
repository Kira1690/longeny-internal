import { verifyHmac } from '@longeny/middleware';
import { Elysia } from 'elysia';
import type { BookingController } from '../controllers/booking.controller.js';
import type { InternalController } from '../controllers/internal.controller.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const TAGS = ['Internal'];

/**
 * HMAC-signed service-to-service calls, not bearer-token calls, so no
 * `security` block: a JWT is never accepted here and the gateway does not
 * expose `/internal/*` to the browser at all.
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

const userIdParam: OpenApiFragment = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'LONGENY user id whose booking data is being exported or erased',
};

const hmacErrors: OpenApiFragment = {
  401: errorDoc(
    'Missing HMAC headers, a timestamp outside the 30-second window, or a signature that did not verify',
    'UNAUTHORIZED',
  ),
};

export function createInternalRoutes(
  controller: InternalController,
  booking: BookingController,
  hmacSecret: string,
) {
  return new Elysia({ prefix: '/internal' })
    .use(verifyHmac(hmacSecret))

    .get('/bookings/access', booking.providerAccess, {
      detail: {
        tags: TAGS,
        summary: 'Does this provider have an active engagement with this profile?',
        description:
          'Service-to-service only. This is the basis for a provider reading a patient’s records: ' +
          'there is no ambient provider access, only access derived from a booking that exists and ' +
          'has not been cancelled. A cancelled or no-show booking does not count; a completed one ' +
          'does, because a clinician still needs the notes for someone they saw last month.\n\n' +
          'ai-content asks this before serving a profile’s reports to a provider.',
        parameters: [
          ...hmacHeaders,
          {
            name: 'providerId',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'profileId',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: okDoc(
            'Whether access is justified, and by what',
            {
              type: 'object',
              properties: {
                hasAccess: { type: 'boolean' },
                basis: {
                  type: 'string',
                  nullable: true,
                  description: 'The booking that justifies it, or null',
                  example: 'booking:9a2b…',
                },
              },
            },
            { hasAccess: true, basis: 'booking:9a2b1f7c-3f4e-4a6d-8a51-6a1f0d1b2c33' },
          ),
          ...hmacErrors,
        },
      },
    })

    .get('/gdpr/user-data/:userId', controller.getUserData, {
      detail: {
        tags: TAGS,
        summary: 'Export a user’s bookings and notifications (DSAR)',
        description:
          'Service-to-service only. Returns everything this service holds about the user, for ' +
          'inclusion in a data-subject access request assembled by the user service. Not ' +
          'reachable through the gateway.',
        parameters: [...hmacHeaders, userIdParam],
        responses: {
          200: okDoc('Booking-service records for the user', {
            type: 'object',
            properties: {
              bookings: { type: 'array', items: { type: 'object' } },
              notifications: { type: 'array', items: { type: 'object' } },
              exportedAt: { type: 'string', format: 'date-time' },
            },
          }),
          ...hmacErrors,
        },
      },
    })

    .delete('/gdpr/user-data/:userId', controller.deleteUserData, {
      detail: {
        tags: TAGS,
        summary: 'Anonymise a user’s booking data (GDPR erasure)',
        description:
          'Service-to-service only. Bookings are anonymised rather than deleted — the provider ' +
          'side of a past appointment has to survive — while notifications are deleted outright. ' +
          'Idempotent: a user with nothing stored still answers 200.',
        parameters: [...hmacHeaders, userIdParam],
        responses: {
          200: okDoc(
            'Erasure completed',
            {
              type: 'object',
              properties: {
                anonymized: { type: 'boolean', example: true },
                userId: { type: 'string', format: 'uuid' },
                processedAt: { type: 'string', format: 'date-time' },
              },
            },
            {
              anonymized: true,
              userId: '22222222-2222-2222-2222-222222222222',
              processedAt: '2026-08-26T12:00:00.000Z',
            },
          ),
          ...hmacErrors,
        },
      },
    });
}
