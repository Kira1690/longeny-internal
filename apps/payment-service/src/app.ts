import { Elysia } from 'elysia';
import { errorHandler, requestLogger, corsMiddleware } from '@longeny/middleware';
import { loadConfig, paymentConfigSchema } from '@longeny/config';
import { paymentRoutes, subscriptionRoutes, webhookRoutes, internalRoutes, providerRoutes } from './routes/index.js';

const config = loadConfig(paymentConfigSchema);

const app = new Elysia()
  // ── Error handler (outermost — catches errors from all middleware) ──
  .use(errorHandler())
  // ── Request logger ──
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
