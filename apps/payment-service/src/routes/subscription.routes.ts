import { permissionGuard, requireAuth } from '@longeny/middleware';
import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
} from '@longeny/validators';
import { Elysia } from 'elysia';
import * as subscriptionController from '../controllers/subscription.controller.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };
const TAGS = ['Subscriptions'];

const SUBSCRIPTION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid', nullable: true },
    program_id: { type: 'string', format: 'uuid', nullable: true },
    plan_name: { type: 'string' },
    amount: { type: 'string', description: 'Decimal major units per interval, e.g. "29.00"' },
    currency: { type: 'string', example: 'USD' },
    interval: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },
    status: {
      type: 'string',
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'incomplete'],
    },
    current_period_start: { type: 'string', format: 'date-time', nullable: true },
    current_period_end: { type: 'string', format: 'date-time', nullable: true },
    cancel_at_period_end: { type: 'boolean' },
    cancelled_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const idParam: OpenApiFragment = {
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: 'Subscription id (must belong to the authenticated user)',
    },
  ],
};

function ownedErrors(permission: string): OpenApiFragment {
  return {
    401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
    403: errorDoc(`Token lacks the \`${permission}\` permission`, 'FORBIDDEN'),
    404: errorDoc(
      'Subscription not found, or owned by another account — the two are deliberately indistinguishable, so never infer that an id is real from this response',
      'NOT_FOUND',
    ),
  };
}

const subscriptionRoutes = new Elysia({ prefix: '/payments/subscriptions' })
  .use(requireAuth())

  .post('/', subscriptionController.createSubscription, {
    body: documented(createSubscriptionSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: TAGS,
      summary: 'Start a recurring subscription',
      description:
        'Creates a gateway subscription for the authenticated user and returns the local record ' +
        'plus whatever the gateway needs the client to confirm.\n\n' +
        '> **Known contract defect.** The route validator and the handler validate different ' +
        'shapes, and Elysia strips anything the route validator does not declare before the ' +
        'handler sees it. The handler additionally requires `providerId` (uuid), `priceId` ' +
        '(gateway price id), `planName` and `amount`, none of which this route declares, so the ' +
        'endpoint currently answers `400 VALIDATION_ERROR` for every request. Do not build ' +
        'against it yet.',
      ...bearer,
      requestBody: bodyDoc(createSubscriptionSchema),
      responses: {
        201: okDoc('Subscription created', SUBSCRIPTION_SHAPE),
        400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
        401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
        403: errorDoc('Token lacks the `payments:write` permission', 'FORBIDDEN'),
      },
    },
  })

  .get('/', subscriptionController.listSubscriptions, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: TAGS,
      summary: 'List the caller’s subscriptions',
      description: 'Always scoped to the authenticated user. Paginated, newest first.',
      ...bearer,
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: 'Filter by status (trialing, active, past_due, cancelled, incomplete)',
        },
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
          description: 'Page of subscriptions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { type: 'array', items: SUBSCRIPTION_SHAPE },
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
        401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
        403: errorDoc('Token lacks the `payments:read` permission', 'FORBIDDEN'),
      },
    },
  })

  .get('/:id', subscriptionController.getSubscriptionDetail, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: TAGS,
      summary: 'Get one subscription',
      ...bearer,
      ...idParam,
      responses: {
        200: okDoc('Subscription detail', SUBSCRIPTION_SHAPE),
        ...ownedErrors('payments:read'),
      },
    },
  })

  .put('/:id', subscriptionController.updateSubscription, {
    body: documented(updateSubscriptionSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: TAGS,
      summary: 'Change a subscription’s plan',
      description:
        'Partial update against a subscription that is not cancelled.\n\n' +
        '> **Known contract defect.** The handler updates `priceId`, `planName`, `quantity` and ' +
        '`amount`; this route declares `planId`, `interval` and `metadata` instead, and Elysia ' +
        'strips undeclared fields before the handler runs. Every field this route accepts is ' +
        'therefore discarded, and the call succeeds while changing nothing.',
      ...bearer,
      ...idParam,
      requestBody: bodyDoc(updateSubscriptionSchema),
      responses: {
        200: okDoc('Subscription after the update', SUBSCRIPTION_SHAPE),
        400: errorDoc(
          'Validation failed, the subscription is already cancelled, or it has no gateway reference',
          'VALIDATION_ERROR',
        ),
        ...ownedErrors('payments:write'),
      },
    },
  })

  .patch('/:id/cancel', subscriptionController.cancelSubscription, {
    body: documented(cancelSubscriptionSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: TAGS,
      summary: 'Cancel a subscription',
      description:
        'Cancels at the end of the current billing period. The body is optional; `reason` is ' +
        'recorded on the record.\n\n' +
        'Note: `cancelAtPeriodEnd` has no effect — the handler reads a field named `immediately`, ' +
        'which this route does not declare, so cancellation is **always** deferred to the end of ' +
        'the period. Cancelling an already-cancelled subscription answers 400.',
      ...bearer,
      ...idParam,
      requestBody: bodyDoc(cancelSubscriptionSchema),
      responses: {
        200: okDoc('Subscription after cancellation', SUBSCRIPTION_SHAPE),
        400: errorDoc(
          'Validation failed, or the subscription is already cancelled',
          'VALIDATION_ERROR',
        ),
        ...ownedErrors('payments:write'),
      },
    },
  });

export default subscriptionRoutes;
