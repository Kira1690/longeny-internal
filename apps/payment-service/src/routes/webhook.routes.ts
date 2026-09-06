import { Elysia } from 'elysia';
import * as webhookController from '../controllers/webhook.controller.js';
import { type OpenApiFragment, errorDoc } from './swagger-helpers.js';

const TAGS = ['Webhooks'];

/**
 * Raw JSON exactly as the gateway sent it. The body is deliberately *not*
 * declared as a route validator: the handler re-reads `request.text()` and the
 * signature is computed over those bytes, so any parse-and-reserialise step
 * would break verification.
 */
const rawGatewayBody: OpenApiFragment = {
  required: true,
  description: 'Raw event JSON exactly as the gateway sent it — do not reformat',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        description: 'Gateway event envelope (shape varies by event type)',
        additionalProperties: true,
      },
    },
  },
};

const receivedResponse: OpenApiFragment = {
  description: 'Event accepted. The gateway retries on any non-2xx, so this is deliberately terse.',
  content: {
    'application/json': {
      schema: { type: 'object', properties: { received: { type: 'boolean', example: true } } },
    },
  },
};

// NO auth middleware on webhook routes
// Raw body access: handlers use request.text() for signature verification
const webhookRoutes = new Elysia({ prefix: '/payments/webhooks' })
  .post('/stripe', webhookController.stripeWebhook, {
    detail: {
      tags: TAGS,
      summary: 'Stripe webhook receiver (gateway → LONGENY)',
      description:
        'Called by Stripe, never by a browser or an app. There is no bearer token: the request is ' +
        'authenticated by the `Stripe-Signature` header, verified against the raw request bytes ' +
        'with the endpoint signing secret. A missing header or an empty body is refused before ' +
        'anything is processed.\n\n' +
        'Frontend engineers need nothing from this endpoint — it is listed so the payment surface ' +
        'is complete. Order and refund status changes reach the UI through the order/refund read ' +
        'endpoints, not through this route.',
      parameters: [
        {
          name: 'Stripe-Signature',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'HMAC signature over the raw body, issued by Stripe',
        },
      ],
      requestBody: rawGatewayBody,
      responses: {
        200: receivedResponse,
        400: errorDoc(
          'Missing `Stripe-Signature` header, empty body, or the signature did not verify',
          'BAD_REQUEST',
        ),
      },
    },
  })

  .post('/razorpay', webhookController.razorpayWebhook, {
    detail: {
      tags: TAGS,
      summary: 'Razorpay webhook receiver (gateway → LONGENY)',
      description:
        'Called by Razorpay, never by a browser or an app. Authenticated by the ' +
        '`X-Razorpay-Signature` header over the raw request bytes; no bearer token is involved. ' +
        'A missing header or an empty body is refused before anything is processed.',
      parameters: [
        {
          name: 'X-Razorpay-Signature',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'HMAC signature over the raw body, issued by Razorpay',
        },
      ],
      requestBody: rawGatewayBody,
      responses: {
        200: receivedResponse,
        400: errorDoc(
          'Missing `X-Razorpay-Signature` header, empty body, or the signature did not verify',
          'BAD_REQUEST',
        ),
      },
    },
  });

export default webhookRoutes;
