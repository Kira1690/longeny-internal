import {
  permissionGuard,
  remoteProfileContext,
  requireAuth,
  requireRole,
} from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import {
  createCheckoutSchema,
  createOrderSchema,
  createPaymentIntentSchema,
  createSetupIntentSchema,
  payOrderSchema,
  requestRefundSchema,
} from '@longeny/validators';
import { Elysia } from 'elysia';
import { config } from '../config/index.js';
import * as paymentController from '../controllers/payment.controller.js';
import { type OpenApiFragment, bodyDoc, documented, errorDoc, okDoc } from './swagger-helpers.js';

const bearer = { security: [{ BearerAuth: [] }] };

// ── Shared documentation fragments ───────────────────────────────────────────

/** Every route below sits behind `requireAuth()`. */
const authErrors: OpenApiFragment = {
  401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
};

/** Errors for a route that reads an id out of the path. */
function ownedResourceErrors(permission: string, resource: string): OpenApiFragment {
  return {
    ...authErrors,
    403: errorDoc(`Token lacks the \`${permission}\` permission`, 'FORBIDDEN'),
    404: errorDoc(
      `${resource} not found, or owned by another account — the two are deliberately indistinguishable, so never infer that an id is real from this response`,
      'NOT_FOUND',
    ),
  };
}

function permissionError(permission: string): OpenApiFragment {
  return { 403: errorDoc(`Token lacks the \`${permission}\` permission`, 'FORBIDDEN') };
}

const paginationParams: OpenApiFragment[] = [
  {
    name: 'page',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: '1-based page number',
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 20 },
    description: 'Rows per page',
  },
];

function statusParam(values: string): OpenApiFragment {
  return {
    name: 'status',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: `Filter by status (${values})`,
  };
}

function idParam(description: string): OpenApiFragment {
  return {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description,
      },
    ],
  };
}

const PAGINATION_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

const ORDER_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    order_number: { type: 'string', example: 'ORD-20260826-0001' },
    user_id: { type: 'string', format: 'uuid' },
    provider_id: { type: 'string', format: 'uuid', nullable: true },
    booking_id: { type: 'string', format: 'uuid', nullable: true },
    order_type: { type: 'string', enum: ['session', 'program', 'product', 'subscription'] },
    status: {
      type: 'string',
      enum: ['pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded'],
    },
    currency: { type: 'string', example: 'USD' },
    subtotal: { type: 'string', description: 'Decimal major units, e.g. "49.99"' },
    platform_fee: { type: 'string', nullable: true },
    tax_amount: { type: 'string', nullable: true },
    total_amount: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const REFUND_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    order_id: { type: 'string', format: 'uuid' },
    payment_id: { type: 'string', format: 'uuid', nullable: true },
    amount: { type: 'string' },
    currency: { type: 'string' },
    reason: { type: 'string' },
    status: {
      type: 'string',
      enum: ['requested', 'approved', 'processing', 'succeeded', 'failed', 'rejected'],
    },
    requested_by: { type: 'string', format: 'uuid' },
    approved_by: { type: 'string', format: 'uuid', nullable: true },
    approved_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const INVOICE_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    invoice_number: { type: 'string' },
    user_id: { type: 'string', format: 'uuid' },
    order_id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['draft', 'issued', 'paid', 'void'] },
    currency: { type: 'string' },
    total_amount: { type: 'string' },
    issued_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const PAYMENT_METHOD_SHAPE: OpenApiFragment = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'pm_1QabcDEF' },
    type: { type: 'string', example: 'card' },
    card: {
      type: 'object',
      nullable: true,
      properties: {
        brand: { type: 'string', example: 'visa' },
        last4: { type: 'string', example: '4242' },
        expMonth: { type: 'integer', example: 12 },
        expYear: { type: 'integer', example: 2030 },
      },
    },
  },
};

const paymentRoutes = new Elysia({ prefix: '/payments' })
  .use(requireAuth())
  // An order records the subject of care it was bought for. Authorisation stays
  // with the account — money is never scoped by profile — but a family needs to
  // see what was purchased for whom.
  .use(
    remoteProfileContext({
      serviceName: 'payment-service',
      userProviderUrl: config.USER_PROVIDER_SERVICE_URL,
      hmacSecret: config.HMAC_SECRET,
      // Recorded, not required: the account is the scope, and this service must
      // keep working when user-provider does not.
      mode: 'header-only',
    }),
  )

  .post('/checkout', paymentController.checkout, {
    body: documented(createCheckoutSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Checkout'],
      summary: 'Create an order and start a gateway checkout',
      description:
        'One-shot purchase: creates the order from `items[]` and returns the gateway session ' +
        'the client should redirect the buyer to. `successUrl` / `cancelUrl` are where the ' +
        'gateway sends the buyer back afterwards. The order is created against the ' +
        'authenticated user; `providerId` says who is being paid.\n\n' +
        'Totals are computed server-side from the line items — `unitPrice` is decimal major ' +
        'units (e.g. `49.99`), and `platformFeePercent` / `taxRate` are percentages, not ' +
        'amounts. Use `POST /payments/orders` instead if you want to create the order now and ' +
        'collect payment later.',
      ...bearer,
      requestBody: bodyDoc(createCheckoutSchema),
      responses: {
        201: okDoc('Order created and checkout session opened', {
          type: 'object',
          properties: {
            orderId: { type: 'string', format: 'uuid' },
            orderNumber: { type: 'string' },
            checkoutUrl: { type: 'string', description: 'Redirect the buyer here' },
            sessionId: { type: 'string' },
          },
        }),
        400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
        ...authErrors,
        ...permissionError('payments:write'),
      },
    },
  })

  .post('/orders', paymentController.createOrder, {
    body: documented(createOrderSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Orders'],
      summary: 'Create an unpaid order',
      description:
        'Creates an order in `pending` without touching a payment gateway. Pay it later with ' +
        '`POST /payments/orders/{id}/pay`. Totals (subtotal, platform fee, tax) are computed ' +
        'server-side from the line items, so the client never sends a total.',
      ...bearer,
      requestBody: bodyDoc(createOrderSchema),
      responses: {
        201: okDoc('Order created', ORDER_SHAPE),
        400: errorDoc('Request body failed validation', 'VALIDATION_ERROR'),
        ...authErrors,
        ...permissionError('payments:write'),
      },
    },
  })

  .get('/orders', paymentController.listOrders, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Orders'],
      summary: 'List the caller’s orders',
      description:
        'Paginated, newest first by default, and always scoped to the authenticated user — there ' +
        'is no way to list another account’s orders.',
      ...bearer,
      parameters: [
        statusParam('pending, processing, paid, failed, cancelled, refunded'),
        ...paginationParams,
        {
          name: 'sortBy',
          in: 'query',
          required: false,
          schema: { type: 'string', default: 'created_at' },
          description: 'Column to sort on',
        },
        {
          name: 'sortOrder',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      ],
      responses: {
        200: {
          description: 'Page of orders',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { type: 'array', items: ORDER_SHAPE },
                  pagination: PAGINATION_SHAPE,
                },
              },
            },
          },
        },
        ...authErrors,
        ...permissionError('payments:read'),
      },
    },
  })

  .get('/orders/:id', paymentController.getOrderDetail, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Orders'],
      summary: 'Get one order with its line items and payments',
      ...bearer,
      ...idParam('Order id (must belong to the authenticated user)'),
      responses: {
        200: okDoc('Order detail', {
          ...ORDER_SHAPE,
          properties: {
            ...ORDER_SHAPE.properties,
            items: { type: 'array', items: { type: 'object' } },
            payments: { type: 'array', items: { type: 'object' } },
          },
        }),
        ...ownedResourceErrors('payments:read', 'Order'),
      },
    },
  })

  .post('/orders/:id/pay', paymentController.payOrder, {
    body: documented(payOrderSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Orders'],
      summary: 'Pay an existing order',
      description:
        'Opens a gateway checkout for an order that is still `pending` and returns the URL to ' +
        'redirect the buyer to. `successUrl` and `cancelUrl` are both required — they are where ' +
        'the gateway returns the buyer. An order that is already paid or cancelled answers 400.',
      ...bearer,
      ...idParam('Order id (must belong to the authenticated user)'),
      requestBody: bodyDoc(payOrderSchema),
      responses: {
        200: okDoc('Checkout opened for the order', {
          type: 'object',
          properties: {
            checkoutUrl: { type: 'string' },
            sessionId: { type: 'string' },
          },
        }),
        400: errorDoc(
          'Request body failed validation, or the order is not in a payable status',
          'VALIDATION_ERROR',
        ),
        ...ownedResourceErrors('payments:write', 'Order'),
      },
    },
  })

  .post('/create-intent', paymentController.createPaymentIntent, {
    body: documented(createPaymentIntentSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Checkout'],
      summary: 'Create a bare payment intent',
      description:
        'For clients that collect card details themselves (Stripe Elements and similar): ' +
        'returns a `clientSecret` to confirm on the client. `amount` is decimal major units ' +
        '(e.g. `49.99`), not cents.\n\n' +
        'The intent stands alone — it is **not** linked to an order, so nothing here updates an ' +
        'order’s status. Use `POST /payments/checkout` or `POST /payments/orders/{id}/pay` when ' +
        'the payment should settle an order.',
      ...bearer,
      requestBody: bodyDoc(createPaymentIntentSchema),
      responses: {
        201: okDoc('Payment intent created', {
          type: 'object',
          properties: {
            clientSecret: { type: 'string' },
            paymentIntentId: { type: 'string' },
          },
        }),
        400: errorDoc(
          'Request body failed validation, or the user has no gateway customer yet',
          'VALIDATION_ERROR',
        ),
        ...authErrors,
        ...permissionError('payments:write'),
      },
    },
  })

  .post('/setup-intent', paymentController.createSetupIntent, {
    body: documented(createSetupIntentSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Payment Methods'],
      summary: 'Create a setup intent to save a card for later',
      description:
        'Returns a `clientSecret` the client confirms to store a card against the caller’s ' +
        'gateway customer, without charging it. The customer is resolved from the access token ' +
        '— there is no customer id in the request — and must already exist, so the caller has ' +
        'to have completed a checkout at least once; otherwise this answers 400.',
      ...bearer,
      requestBody: bodyDoc(createSetupIntentSchema),
      responses: {
        201: okDoc('Setup intent created', {
          type: 'object',
          properties: {
            clientSecret: { type: 'string' },
            setupIntentId: { type: 'string' },
          },
        }),
        400: errorDoc('No payment customer found — complete a checkout first', 'BAD_REQUEST'),
        ...authErrors,
        ...permissionError('payments:write'),
      },
    },
  })

  .get('/methods', paymentController.listPaymentMethods, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Payment Methods'],
      summary: 'List saved cards',
      description:
        'Cards stored at the gateway for the caller. Only the display fields come back — brand, ' +
        'last four digits and expiry. Full card data never touches this service.',
      ...bearer,
      responses: {
        200: okDoc('Saved payment methods', { type: 'array', items: PAYMENT_METHOD_SHAPE }, [
          {
            id: 'pm_1QabcDEF',
            type: 'card',
            card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
          },
        ]),
        400: errorDoc('No payment customer found — complete a checkout first', 'BAD_REQUEST'),
        ...authErrors,
        ...permissionError('payments:read'),
      },
    },
  })

  .post('/methods', paymentController.addPaymentMethod, {
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Payment Methods'],
      summary: 'Start saving a card (returns a setup intent)',
      description:
        'This route **ignores its body entirely**: the handler takes only the user id from the ' +
        'token and returns a fresh Stripe setup intent, identical to ' +
        '`POST /payments/setup-intent`. Nothing is attached, `setAsDefault` has no effect, and ' +
        'there is no server-side body validation at all — the client must confirm the returned ' +
        '`clientSecret` to actually store the card. The fields below record the intended ' +
        'contract, not current behaviour.',
      ...bearer,
      requestBody: {
        required: false,
        description: 'Accepted but ignored — the handler reads nothing from it',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                paymentGateway: { type: 'string', enum: ['stripe', 'razorpay'], default: 'stripe' },
                paymentMethodId: { type: 'string', example: 'pm_1QabcDEF' },
                setAsDefault: { type: 'boolean', default: false },
              },
            },
          },
        },
      },
      responses: {
        201: okDoc('Setup intent created — confirm it client-side to save the card', {
          type: 'object',
          properties: {
            clientSecret: { type: 'string' },
            setupIntentId: { type: 'string' },
          },
        }),
        400: errorDoc('No payment customer found — complete a checkout first', 'BAD_REQUEST'),
        ...authErrors,
        ...permissionError('payments:write'),
      },
    },
  })

  .delete('/methods/:id', paymentController.removePaymentMethod, {
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Payment Methods'],
      summary: 'Detach a saved card',
      description:
        'Detaches the card from the caller’s gateway customer. The id is the **gateway** payment ' +
        'method id (e.g. `pm_…`), not a LONGENY uuid.',
      ...bearer,
      ...idParam('Gateway payment method id, e.g. `pm_1QabcDEF`'),
      responses: {
        200: okDoc('Card detached', {
          type: 'object',
          properties: { message: { type: 'string', example: 'Payment method removed' } },
        }),
        400: errorDoc('No payment customer found', 'BAD_REQUEST'),
        ...ownedResourceErrors('payments:write', 'Payment method'),
      },
    },
  })

  .post('/refunds', paymentController.requestRefund, {
    body: documented(requestRefundSchema),
    beforeHandle: permissionGuard('payments:write'),
    detail: {
      tags: ['Refunds'],
      summary: 'Request a refund on an order',
      description:
        'Files a refund request against a paid order the caller owns. Nothing moves until an ' +
        'admin approves it with `PUT /payments/refunds/{id}/approve` — the new refund comes ' +
        'back in status `requested`. Omit `amount` for a full refund; a partial amount may not ' +
        'exceed the order total.',
      ...bearer,
      requestBody: bodyDoc(requestRefundSchema),
      responses: {
        201: okDoc('Refund requested', REFUND_SHAPE),
        400: errorDoc(
          'Validation failed, the order is not refundable, it has no successful payment, or the amount exceeds the order total',
          'VALIDATION_ERROR',
        ),
        ...ownedResourceErrors('payments:write', 'Order'),
      },
    },
  })

  .get('/refunds', paymentController.listRefunds, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Refunds'],
      summary: 'List the caller’s refund requests',
      ...bearer,
      parameters: [
        statusParam('requested, approved, processing, succeeded, failed, rejected'),
        ...paginationParams,
      ],
      responses: {
        200: {
          description: 'Page of refunds',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { type: 'array', items: REFUND_SHAPE },
                  pagination: PAGINATION_SHAPE,
                },
              },
            },
          },
        },
        ...authErrors,
        ...permissionError('payments:read'),
      },
    },
  })

  .get('/invoices', paymentController.listInvoices, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Invoices'],
      summary: 'List the caller’s invoices',
      ...bearer,
      parameters: [statusParam('draft, issued, paid, void'), ...paginationParams],
      responses: {
        200: {
          description: 'Page of invoices',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { type: 'array', items: INVOICE_SHAPE },
                  pagination: PAGINATION_SHAPE,
                },
              },
            },
          },
        },
        ...authErrors,
        ...permissionError('payments:read'),
      },
    },
  })

  .get('/invoices/:id/download', paymentController.downloadInvoice, {
    beforeHandle: permissionGuard('payments:read'),
    detail: {
      tags: ['Invoices'],
      summary: 'Get a time-limited download URL for an invoice PDF',
      description:
        'Returns a signed URL rather than the file itself, so the browser can download directly. ' +
        'The URL expires — fetch it when the user clicks, not ahead of time.',
      ...bearer,
      ...idParam('Invoice id (must belong to the authenticated user)'),
      responses: {
        200: okDoc('Signed download URL', {
          type: 'object',
          properties: {
            url: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        }),
        ...ownedResourceErrors('payments:read', 'Invoice'),
      },
    },
  });

/**
 * Refund approval moves money and was previously reachable by any authenticated
 * user: the route carried no role or permission guard and the service only
 * recorded who approved it. It now needs the `payments:refund` permission,
 * which only admin roles hold.
 *
 * No prefix of its own: it is mounted inside `paymentRoutes`, and Elysia
 * concatenates the prefixes of nested instances. Carrying `/payments` here
 * moved the guarded route to `/payments/payments/refunds/:id/approve` and left
 * the documented path unrouted.
 */
const refundApprovalRoutes = new Elysia()
  .use(requireAuth())
  .use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN))
  .put('/refunds/:id/approve', paymentController.approveRefund, {
    beforeHandle: permissionGuard('payments:refund'),
    detail: {
      tags: ['Refunds'],
      summary: 'Approve a refund request (admin only)',
      description:
        'Moves a refund from `requested` to approved and releases it to the gateway — this is ' +
        'the call that actually returns money.\n\n' +
        '**Newly guarded.** Two independent checks now apply, both of which a normal user fails: ' +
        'the caller must hold the `admin` or `super_admin` **role**, *and* the token must carry ' +
        'the `payments:refund` **permission**, which is granted only to those roles. Until this ' +
        'week the route had neither guard and any authenticated user could approve a refund. ' +
        'Permissions land in the token at login, so an account promoted to admin must refresh ' +
        'its token before this succeeds.\n\n' +
        'Only a refund still in `requested` can be approved; re-approving answers 400.',
      ...bearer,
      ...idParam('Refund id'),
      responses: {
        200: okDoc('Refund approved and sent to the gateway', REFUND_SHAPE),
        400: errorDoc('Refund is not in a state that can be approved', 'BAD_REQUEST'),
        401: errorDoc('Missing, malformed, expired or revoked access token', 'UNAUTHORIZED'),
        403: errorDoc(
          'Caller is not admin/super_admin, or the token lacks the `payments:refund` permission',
          'FORBIDDEN',
        ),
        404: errorDoc('No such refund', 'NOT_FOUND'),
      },
    },
  });

export default paymentRoutes.use(refundApprovalRoutes);
