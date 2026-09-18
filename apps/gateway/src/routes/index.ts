import { requireAuth, requireRole } from '@longeny/middleware';
import { UserRole } from '@longeny/types';
import Elysia from 'elysia';
import { getConfig } from '../config/index.js';
import { optionalAuth } from '../middleware/optional-auth.js';
import { proxyRequest } from '../proxy.js';

// biome-ignore lint/suspicious/noExplicitAny: Elysia's chained type cannot be expressed as bare Elysia
export function createRoutes(): any {
  const config = getConfig();

  const AUTH_URL = config.AUTH_SERVICE_URL;
  const USER_PROVIDER_URL = config.USER_PROVIDER_SERVICE_URL;
  const BOOKING_URL = config.BOOKING_SERVICE_URL;
  const AI_CONTENT_URL = config.AI_CONTENT_SERVICE_URL;
  const PAYMENT_URL = config.PAYMENT_SERVICE_URL;

  // ── Health check (aggregated) ──
  const healthRoute = new Elysia().get('/health', async () => {
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
          return {
            name: svc.name,
            status: res.ok ? 'healthy' : 'unhealthy',
            statusCode: res.status,
          };
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
  const authProxy = new Elysia().all('/api/v1/auth/*', (ctx) => proxyRequest(ctx, AUTH_URL));

  // ── Webhook routes (public — Stripe signature verification) ──
  const webhookProxy = new Elysia().all('/api/v1/payments/webhooks/*', (ctx) =>
    proxyRequest(ctx, PAYMENT_URL),
  );

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
    .use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN))
    .all('/api/v1/admin/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── RRO intake and AI results (require auth) ──
  //
  // ai-content holds the intake, the classifications and the reports; the
  // classifier itself is /internal and stays unreachable from here.
  const intakeProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/intake', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/intake/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/rro/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL));

  // The reports timeline lives in ai-content while the rest of /profiles is
  // user-provider's, so this one path is routed before the profiles proxy.
  // Elysia matches in registration order, and a wildcard registered later does
  // not shadow a specific path registered earlier.
  const reportsProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/profiles/:profileId/reports', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    // Benchmarks are judged in ai-content, next to the readings they judge.
    .all('/api/v1/profiles/:profileId/benchmarks', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/profiles/:profileId/trends', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/profiles/:profileId/scores', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/reference-ranges', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/reports/:documentId/readings', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/readings/:readingId/corrections', (ctx) => proxyRequest(ctx, AI_CONTENT_URL));

  // ── Profile routes — multi-profile / family (require auth) ──
  // The service re-verifies the token and owns the "is this profile yours"
  // check; the gateway only decides that the path is reachable at all.
  // /internal/* is deliberately absent: those routes are HMAC-only and must not
  // be reachable from outside.
  const profilesProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/profiles', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL))
    .all('/api/v1/profiles/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Progress routes (require auth) ──
  const progressProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/progress/*', (ctx) => proxyRequest(ctx, USER_PROVIDER_URL));

  // ── Booking routes (require auth) ──
  const bookingProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/bookings/*', (ctx) => proxyRequest(ctx, BOOKING_URL))
    .all('/api/v1/notifications/*', (ctx) => proxyRequest(ctx, BOOKING_URL));

  // ── AI routes — patient onboarding and patient agent only ──
  const aiProxy = new Elysia()
    .use(requireAuth())
    .all('/api/v1/ai/onboarding', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/ai/onboarding/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/ai/sessions/*', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/ai/patient-agent/:patientId/session', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/ai/patient-agent/:patientId/answer', (ctx) => proxyRequest(ctx, AI_CONTENT_URL))
    .all('/api/v1/ai/patient-agent/:patientId/stream/:sessionId', (ctx) =>
      proxyRequest(ctx, AI_CONTENT_URL),
    );

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
    .use(intakeProxy)
    .use(reportsProxy)
    .use(profilesProxy)
    .use(progressProxy)
    .use(bookingProxy)
    .use(aiProxy)
    .use(paymentProxy);
}
