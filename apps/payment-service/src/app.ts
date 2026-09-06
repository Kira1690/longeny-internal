import { swagger } from '@elysiajs/swagger';
import { corsMiddleware, errorHandler, requestContext, requestLogger } from '@longeny/middleware';
import { Elysia } from 'elysia';
import { config } from './config/index.js';
import {
  internalRoutes,
  paymentRoutes,
  providerRoutes,
  subscriptionRoutes,
  webhookRoutes,
} from './routes/index.js';

const app = new Elysia()
  // ── Swagger UI at /docs, machine-readable spec at /docs/json ──
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'LONGENY Payment Service API',
          version: '1.0.0',
          description:
            'Orders, checkout, payment methods, refunds, invoices, subscriptions, provider ' +
            'earnings and gateway webhooks.\n\n' +
            '**Auth.** Every route outside `/payments/webhooks/*` and `/internal/*` needs a ' +
            'Bearer access token from the Auth service, and additionally the permission named ' +
            'in each operation. A token that is valid but lacks the permission gets `403 ' +
            'FORBIDDEN` with a message naming what is missing.\n\n' +
            '**Ownership.** Every order, refund, invoice, subscription and payment method is ' +
            'scoped to the caller. A record that belongs to somebody else answers exactly like ' +
            'one that does not exist — `404 NOT_FOUND` — so never infer that an id is real ' +
            'from the response.\n\n' +
            '**Money amounts** are decimal major units (e.g. `49.99`), not cents, and `currency` ' +
            'is a 3-letter ISO code.',
        },
        tags: [
          {
            name: 'Checkout',
            description: 'Start a payment: create an order and hand back a gateway redirect',
          },
          { name: 'Orders', description: 'Order list, detail and payment' },
          { name: 'Payment Methods', description: 'Saved cards held at the gateway' },
          { name: 'Refunds', description: 'Refund requests and admin approval' },
          { name: 'Invoices', description: 'Invoice list and signed download links' },
          { name: 'Subscriptions', description: 'Recurring plans — create, update, cancel' },
          {
            name: 'Provider Earnings',
            description: 'Provider-only earnings and payout history',
          },
          {
            name: 'Webhooks',
            description:
              'Gateway callbacks (Stripe / Razorpay). Unauthenticated — verified by signature. ' +
              'Not for browser use.',
          },
          {
            name: 'Internal',
            description:
              'Service-to-service endpoints (HMAC-signed) — not reachable from the browser',
          },
        ],
        components: {
          securitySchemes: {
            BearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
    }),
  )
  // ── Error handler (outermost — catches errors from all middleware) ──
  .use(errorHandler())
  // ── Request logger ──
  .use(requestContext())
  .use(requestLogger('payment-service'))
  // ── CORS ──
  .use(corsMiddleware(config.CORS_ORIGIN.split(',')))
  // ── Health check ──
  .get('/health', () => ({
    success: true,
    data: {
      service: 'payment-service',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.0.1',
    },
  }))
  // ── Webhook routes (NO auth — Stripe/Razorpay signature verification in handler) ──
  .use(webhookRoutes)
  // ── Authenticated payment routes ──
  .use(paymentRoutes)
  .use(subscriptionRoutes)
  .use(providerRoutes)
  // ── Internal HMAC-protected routes ──
  .use(internalRoutes);

export default app;
