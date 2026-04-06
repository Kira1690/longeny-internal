import Elysia from 'elysia';
import { requestLogger, corsMiddleware, rateLimit, errorHandler } from '@longeny/middleware';
import { getConfig } from './config/index.js';
import { createRoutes } from './routes/index.js';

export function createApp(): Elysia {
  const config = getConfig();
  const origins = config.CORS_ORIGIN.split(',').map((o) => o.trim());

  const routes = createRoutes();

  const app = new Elysia()
    // ── 1. Error handler (outermost — catches errors from all middleware) ──
    .use(errorHandler())
    // ── 2. Request logger (generates / propagates correlation ID) ──
    .use(requestLogger('gateway'))
    // ── 3. CORS ──
    .use(corsMiddleware(origins))
    // ── 4. Rate limiting ──
    .use(
      rateLimit({
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        max: config.RATE_LIMIT_MAX_REQUESTS,
        keyPrefix: 'gateway',
      }),
    )
    // ── 5. Routes (auth middleware applied per-route inside createRoutes) ──
    .use(routes)
    // ── Catch-all 404 ──
    .all('*', ({ request, set }) => {
      set.status = 404;
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${request.method} ${new URL(request.url).pathname} not found`,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };
    });

  return app;
}

export const app = createApp();
