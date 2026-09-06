import { permissionGuard, requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { calendarInviteSchema } from '@longeny/validators';
import { Elysia } from 'elysia';
import type { CalendarController } from '../controllers/calendar.controller.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Calendar'];

const unauthorized = errorDoc(
  'Missing, malformed, expired or revoked access token',
  'UNAUTHORIZED',
);

const notProvider: OpenApiFragment = errorDoc(
  'Caller does not hold the `provider` role',
  'FORBIDDEN',
);

export function createCalendarRoutes(controller: CalendarController) {
  const authRequired = requireAuth();
  const providerRequired = requireRole(UserRole.PROVIDER);

  /**
   * Inviting is not a provider-only action: the account owner books for a
   * dependent and needs to send them the appointment. Connecting a Google
   * calendar below is provider-only, so the two sit in separate groups.
   */
  const inviteRoutes = new Elysia({ prefix: '/bookings/calendar' })
    .use(authRequired)
    .post('/invite', controller.sendInvite, {
      beforeHandle: permissionGuard('bookings:write'),
      body: documented(calendarInviteSchema),
      detail: {
        tags: TAGS,
        summary: 'Send a calendar invite to a profile with no login',
        description:
          'Builds a real RFC 5545 invite and delivers it to the profile\u2019s active calendar ' +
          'targets, which is how a dependent \u2014 a parent, a child \u2014 learns about an ' +
          'appointment at all: they never sign in.\n\n' +
          'The recipient is named by profile, never by address. The address comes from the ' +
          'profile\u2019s notification targets, so this endpoint cannot be pointed at an arbitrary ' +
          'mailbox.\n\n' +
          'Every attempt is recorded in the profile\u2019s notification log. If nothing was ' +
          'delivered the response is **502** and the log row says why \u2014 a 200 for a message ' +
          'that never left would be worse than useless to whoever is chasing it.\n\n' +
          'The invite carries a stable UID derived from the profile and start time, so ' +
          're-sending the same appointment updates the recipient\u2019s existing calendar entry ' +
          'instead of adding a second one.',
        ...bearer,
        requestBody: bodyDoc(calendarInviteSchema),
        responses: {
          200: okDoc(
            'Invite delivered to at least one target',
            {
              type: 'object',
              properties: {
                profileId: { type: 'string', format: 'uuid' },
                delivered: { type: 'integer' },
                attempted: { type: 'integer' },
                entries: { type: 'array', items: { type: 'object' } },
              },
            },
            { profileId: 'df864dbd-4eb5-4785-8299-28bb09a69246', delivered: 1, attempted: 1 },
          ),
          400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
          401: unauthorized,
          403: errorDoc('Token lacks bookings:write', 'FORBIDDEN'),
          404: errorDoc('No such profile', 'NOT_FOUND'),
          502: errorDoc(
            'Nothing was delivered \u2014 no active calendar target, or the mail transport refused it. The reason is in the notification log.',
            'DELIVERY_FAILED',
          ),
        },
      },
    });

  const providerRoutes = new Elysia({ prefix: '/bookings/calendar' })
    .use(authRequired)
    .use(providerRequired)

    .get('/connect', controller.getConnectUrl, {
      detail: {
        tags: TAGS,
        summary: 'Get the Google consent URL to connect a calendar',
        description:
          'Step 1 of 2. Returns the Google OAuth URL to send the provider to. The `state` ' +
          'parameter baked into that URL is signed and names the calling provider, so a URL ' +
          'issued for one provider cannot be completed by another — fetch it fresh per ' +
          'connection attempt rather than caching it. Provider role only; there is no ' +
          'permission check beyond the role.',
        ...bearer,
        responses: {
          200: okDoc('Consent URL to redirect the provider to', {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Google OAuth consent URL, already signed' },
            },
          }),
          401: unauthorized,
          403: notProvider,
        },
      },
    })

    .get('/callback', controller.handleCallback, {
      detail: {
        tags: TAGS,
        summary: 'Complete the Google OAuth connection',
        description:
          'Step 2 of 2. Google redirects back with `code` and `state`; hand both to this ' +
          'endpoint **with the provider’s bearer token attached** — the caller must be the same ' +
          'provider the `state` was issued for, or the call is refused. Tokens are encrypted at ' +
          'rest and never returned.\n\n' +
          'Two failure shapes to handle: a user who declines consent comes back with `error` ' +
          'and answers HTTP **200** carrying `{ success: false, error: { code: ' +
          '"CALENDAR_AUTH_FAILED" } }`, as does a missing `code`/`state` (`BAD_REQUEST`). A ' +
          'tampered, expired or foreign `state` answers a real **400**. Check the `success` ' +
          'flag, not just the status code.',
        ...bearer,
        parameters: [
          {
            name: 'code',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Authorisation code from Google. Required unless `error` is present.',
          },
          {
            name: 'state',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description:
              'Opaque signed value from `/bookings/calendar/connect` — not a provider id',
          },
          {
            name: 'error',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Set by Google when the provider declines consent',
          },
        ],
        responses: {
          200: okDoc(
            'Calendar connected — or an error envelope when the provider declined or `code`/`state` were missing',
            {
              type: 'object',
              properties: {
                connected: { type: 'boolean', example: true },
                calendarId: { type: 'string', example: 'primary' },
                status: { type: 'string', enum: ['active', 'error', 'disconnected'] },
              },
            },
          ),
          400: errorDoc(
            'The OAuth state was tampered with, expired, or was issued for another provider; or Google returned no usable tokens',
            'BAD_REQUEST',
          ),
          401: unauthorized,
          403: notProvider,
          500: errorDoc(
            'Google accepted the code but the connection could not be stored',
            'INTERNAL_ERROR',
          ),
        },
      },
    })

    .delete('/disconnect', controller.disconnect, {
      detail: {
        tags: TAGS,
        summary: 'Disconnect the calling provider’s calendar',
        description:
          'Revokes the stored Google token and marks the connection disconnected. Calling it ' +
          'when no calendar was ever connected answers 404.',
        ...bearer,
        responses: {
          200: okDoc('Calendar disconnected', { type: 'null' }),
          401: unauthorized,
          403: notProvider,
          404: errorDoc('This provider has no calendar connection', 'NOT_FOUND'),
        },
      },
    })

    .get('/status', controller.getStatus, {
      detail: {
        tags: TAGS,
        summary: 'Calendar connection status for the calling provider',
        description:
          'Safe to poll before showing a connect button. A provider who has never connected ' +
          'gets `connected: false` with status `disconnected` and HTTP 200 — never a 404. ' +
          '`errorMessage` is set when a background sync failed and the provider should ' +
          'reconnect.',
        ...bearer,
        responses: {
          200: okDoc(
            'Connection status',
            {
              type: 'object',
              properties: {
                connected: { type: 'boolean' },
                status: { type: 'string', enum: ['active', 'error', 'disconnected'] },
                calendarId: { type: 'string', nullable: true },
                lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
                errorMessage: { type: 'string', nullable: true },
              },
            },
            {
              connected: false,
              status: 'disconnected',
              calendarId: null,
              lastSyncedAt: null,
              errorMessage: null,
            },
          ),
          401: unauthorized,
          403: notProvider,
        },
      },
    });

  return new Elysia().use(inviteRoutes).use(providerRoutes);
}
