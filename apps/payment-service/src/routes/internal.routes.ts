import { verifyHmac } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import * as internalController from '../controllers/internal.controller.js';
import { type OpenApiFragment, errorDoc, okDoc } from './swagger-helpers.js';

const TAGS = ['Internal'];

/**
 * These routes are HMAC-signed service-to-service calls, not bearer-token
 * calls, so they carry no `security` block: a JWT is never accepted here and
 * the gateway does not expose `/internal/*` to the browser at all.
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
  description: 'LONGENY user id whose payment data is being exported or erased',
};

const hmacErrors: OpenApiFragment = {
  401: errorDoc(
    'Missing HMAC headers, a timestamp outside the 30-second window, or a signature that did not verify',
    'UNAUTHORIZED',
  ),
};

const internalRoutes = new Elysia({ prefix: '/internal' })
  .use(verifyHmac(config.HMAC_SECRET))

  .get('/gdpr/user-data/:userId', internalController.getUserPaymentData, {
    detail: {
      tags: TAGS,
      summary: 'Export every payment record for a user (DSAR)',
      description:
        'Service-to-service only. Returns the user’s orders with line items, payments, refunds, ' +
        'subscriptions, gateway customers and invoices, for inclusion in a data-subject access ' +
        'request assembled by the user service. Not reachable through the gateway.',
      parameters: [...hmacHeaders, userIdParam],
      responses: {
        200: okDoc('Complete payment record set for the user', {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            orders: { type: 'array', items: { type: 'object' } },
            payments: { type: 'array', items: { type: 'object' } },
            refunds: { type: 'array', items: { type: 'object' } },
            subscriptions: { type: 'array', items: { type: 'object' } },
            invoices: { type: 'array', items: { type: 'object' } },
            gatewayCustomers: { type: 'array', items: { type: 'object' } },
          },
        }),
        ...hmacErrors,
      },
    },
  })

  .delete('/gdpr/user-data/:userId', internalController.anonymizeUserPaymentData, {
    detail: {
      tags: TAGS,
      summary: 'Anonymise a user’s payment data (GDPR erasure)',
      description:
        'Service-to-service only, and deliberately **not** a full delete: financial records ' +
        'inside the 7-year retention window are legally required, so those are anonymised in ' +
        'place (notes and metadata cleared) while older orders are deleted outright. Gateway ' +
        'customers are removed at the gateway and active subscriptions are cancelled. Returns ' +
        'counts of what happened, and answers 200 even when nothing needed erasing.',
      parameters: [...hmacHeaders, userIdParam],
      responses: {
        200: okDoc(
          'Erasure completed, with counts of what was removed',
          {
            type: 'object',
            properties: {
              userId: { type: 'string', format: 'uuid' },
              message: { type: 'string' },
              oldOrdersDeleted: { type: 'integer' },
              subscriptionsCancelled: { type: 'integer' },
              gatewayCustomersDeleted: { type: 'integer' },
            },
          },
          {
            userId: '22222222-2222-2222-2222-222222222222',
            message:
              'Payment data anonymized. Financial records within 7-year retention period preserved per legal requirements.',
            oldOrdersDeleted: 0,
            subscriptionsCancelled: 1,
            gatewayCustomersDeleted: 1,
          },
        ),
        ...hmacErrors,
      },
    },
  });

export default internalRoutes;
