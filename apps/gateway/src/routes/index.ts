import Elysia from 'elysia';
import { requireAuth, requireRole } from '@longeny/middleware';
import { proxyRequest } from '../proxy.js';
import { getConfig } from '../config/index.js';
import { optionalAuth } from '../middleware/optional-auth.js';

export function createRoutes(): Elysia {
  const config = getConfig();

  const AUTH_URL = config.AUTH_SERVICE_URL;
  const USER_PROVIDER_URL = config.USER_PROVIDER_SERVICE_URL;
  const BOOKING_URL = config.BOOKING_SERVICE_URL;
  const AI_CONTENT_URL = config.AI_CONTENT_SERVICE_URL;
  const PAYMENT_URL = config.PAYMENT_SERVICE_URL;

  // ── Health check (aggregated) ──
  const healthRoute = new Elysia()
    .get('/health', async () => {
      const services = [
        { name: 'auth', url: AUTH_URL },
        { name: 'user-provider', url: USER_PROVIDER_URL },
        { name: 'booking', url: BOOKING_URL },
        { name: 'ai-content', url: AI_CONTENT_URL },
        { name: 'payment', url: PAYMENT_URL },
      ];

      const results = await Promise.allSettled(
        services.map(async (svc) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          try {
            const res = await fetch(`${svc.url}/health`, { signal: controller.signal });
            return { name: svc.name, status: res.ok ? 'healthy' : 'unhealthy', statusCode: res.status };
          } catch {
            return { name: svc.name, status: 'unreachable' as const };
          } finally {
            clearTimeout(timeout);
          }
        }),
      );

      const serviceStatuses = results.map((r) =>
        r.status === 'fulfilled' ? r.value : { name: 'unknown', status: 'error' },
      );

      const allHealthy = serviceStatuses.every((s) => s.status === 'healthy');

      return new Response(
        JSON.stringify({
          status: allHealthy ? 'healthy' : 'degraded',
          gateway: 'healthy',
          services: serviceStatuses,
          timestamp: new Date().toISOString(),
        }),
        {
          status: allHealthy ? 200 : 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

  // ── Auth routes (public — login, register, refresh, etc.) ──
  const authProxy = new Elysia()
    .all('/api/v1/auth/*', (ctx) => proxyRequest(ctx, AUTH_URL));

  // ── Webhook routes (public — Stripe signature verification) ──
  const webhookProxy = new Elysia()
    .all('/api/v1/payments/webhooks/*', (ctx) => proxyRequest(ctx, PAYMENT_URL));

  // ── User & Provider routes (require auth) ──
  const usersProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/users/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Provider & Marketplace routes (optional auth) ──
  const providersProxy = new Elysia()
    .use(optionalAuth())
    .all('/api/v1/providers', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL))
    .all('/api/v1/providers/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL))
    .all('/api/v1/marketplace', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL))
    .all('/api/v1/marketplace/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Admin routes (require auth + admin role) ──
  const adminProxy = new Elysia()
    .use(requireAuth())
    .use(requireRole('admin'))
    .all('/api/v1/admin/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Progress routes (require auth) ──
  const progressProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/progress/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Booking routes (require auth) ──
  const bookingProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/bookings/*', (ctx) => proxyRequest(ctx, BOOKING_URL))
    .all('/api/v1/notifications/*', (ctx) => proxyRequest(ctx, BOOKING_URL));

  // ── AI & Content routes (require auth) ──
  const aiProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/ai/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/documents/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL));

  // ── Payment routes (require auth) ──
  const paymentProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/payments/*', (ctx) => proxyRequest(ctx, PAYMENT_URL));

  return new Elysia()
    .use(healthRoute)
    .use(authProxy)
    .use(webhookProxy)
    .use(usersProxy)
    .use(providersProxy)
    .use(adminProxy)
    .use(progressProxy)
    .use(bookingProxy)
    .use(aiProxy)
    .use(paymentProxy);
}
