import { permissionGuard, requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import { Elysia } from 'elysia';
import * as providerController from '../controllers/provider.controller.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Provider Earnings'];

/**
 * Both routes are role-gated (`provider`, `admin`, `super_admin`) *and*
 * permission-gated, so a caller can fail either check with a 403 — the message
 * says which.
 */
const roleAndPermissionErrors: OpenApiFragment = {
  401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
  403: errorDoc(
    'Caller is not a provider/admin/super_admin, or the token lacks the `payments:read` permission',
    'FORBIDDEN',
  ),
};

// Earnings and payouts are provider-only; the service scopes them to the
// calling provider.
const providerRoutes = new Elysia({ prefix: '/payments/provider' })
  .use(requireAuth())
  .use(requireRole(UserRole.PROVIDER, UserRole.ADMIN, UserRole.SUPER_ADMIN))

  .get('/me/earnings', providerController.getProviderEarnings, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: TAGS,
      summary: 'Earnings summary for the calling provider',
      description:
        'Totals across every paid order where the caller is the provider: gross, platform fee ' +
        'taken, and net owed. There is no path parameter — the provider is always the ' +
        'authenticated caller, so one provider can never read another’s figures. Amounts are ' +
        'decimal major units.',
      ...bearer,
      responses: {
        200: okDoc(
          'Earnings summary',
          {
            type: 'object',
            properties: {
              totalEarnings: { type: 'string' },
              platformFees: { type: 'string' },
              netEarnings: { type: 'string' },
              currency: { type: 'string', example: 'USD' },
              orderCount: { type: 'integer' },
            },
          },
          {
            totalEarnings: '1240.00',
            platformFees: '124.00',
            netEarnings: '1116.00',
            currency: 'USD',
            orderCount: 18,
          },
        ),
        ...roleAndPermissionErrors,
      },
    },
  })

  .get('/me/payouts', providerController.getProviderPayouts, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: TAGS,
      summary: 'Payout history for the calling provider',
      description: 'Paginated list of payouts made to the authenticated provider, newest first.',
      ...bearer,
      parameters: [
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
      ],
      responses: {
        200: {
          description: 'Page of payouts',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        amount: { type: 'string' },
                        currency: { type: 'string' },
                        status: {
                          type: 'string',
                          enum: ['pending', 'processing', 'paid', 'failed'],
                        },
                        period_start: { type: 'string', format: 'date-time', nullable: true },
                        period_end: { type: 'string', format: 'date-time', nullable: true },
                        paid_at: { type: 'string', format: 'date-time', nullable: true },
                        created_at: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
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
        },
        ...roleAndPermissionErrors,
      },
    },
  });

export default providerRoutes;
