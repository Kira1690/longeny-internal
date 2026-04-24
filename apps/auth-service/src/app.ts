import Elysia from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { requestLogger, errorHandler, corsMiddleware } from '@longeny/middleware';
import { config } from './config/index.js';
import routes from './routes/index.js';

const app = new Elysia()
  // ── Swagger UI ──
  .use(swagger({
    path: '/docs',
    documentation: {
      info: {
        title: 'LONGENY Auth Service API',
        version: '1.0.0',
        description: 'Authentication, sessions, consents, and RBAC',
      },
      tags: [
        { name: 'Auth', description: 'Registration, login, tokens, password management' },
        { name: 'Sessions', description: 'Session management across devices' },
        { name: 'Consents', description: 'GDPR consent management' },
        { name: 'Admin', description: 'Admin-only audit log' },
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
  }))
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
