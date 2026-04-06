import Elysia from 'elysia';
import { requestLogger, errorHandler, corsMiddleware } from '@longeny/middleware';
import { config } from './config/index.js';
import routes from './routes/index.js';

const app = new Elysia()
  // ── Global Middleware ──
  .use(errorHandler())
  .use(requestLogger('auth-service'))
  .use(corsMiddleware(config.CORS_ORIGIN.split(',')))
  // ── Health Check ──
  .get('/health', () => {
    return {
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    };
  })
  // ── Application Routes ──
  .use(routes);

export default app;
