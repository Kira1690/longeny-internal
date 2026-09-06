import { swagger } from '@elysiajs/swagger';
import { corsMiddleware, errorHandler, requestContext, requestLogger } from '@longeny/middleware';
import Elysia from 'elysia';
import { config } from './config/index.js';
import routes from './routes/index.js';

const app = new Elysia()
  // ── Swagger UI ──
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'LONGENY Auth Service API',
          version: '1.0.0',
          description:
            'Authentication, sessions, GDPR consents and role-based access control.\n\n' +
            '**Tokens.** `register`, `login`, `refresh` and `google` all return the same pair. ' +
            'The access token’s payload carries `roles` (every role held, not just the highest) ' +
            'and `permissions` — decode it client-side to decide which actions to render; the ' +
            'server re-checks on every request regardless.\n\n' +
            '**Revocation is real.** A password change, a password reset, a role change and ' +
            '`logout-all` each invalidate every access token the account holds, the caller’s ' +
            'included. Expect `401 TOKEN_REVOKED` after any of them and send the user to login.' +
            '\n\n' +
            '**Rate limiting.** One IP-keyed budget of 5 requests per 15 minutes is shared by ' +
            '`POST /auth/login`, `POST /auth/forgot-password` and `POST /auth/reset-password`. ' +
            'No other `/auth` route is limited. Read `X-RateLimit-Remaining` and ' +
            '`X-RateLimit-Reset` from any response.',
        },
        tags: [
          { name: 'Auth', description: 'Registration, login, tokens, password management' },
          { name: 'Sessions', description: 'Session management across devices' },
          { name: 'Consents', description: 'GDPR consent management' },
          {
            name: 'RBAC',
            description:
              'Roles, permissions and role assignment. Admin-only; permission rewriting is super_admin-only.',
          },
          { name: 'Admin', description: 'Admin-only audit log' },
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
  // ── Global Middleware ──
  .use(errorHandler())
  .use(requestContext())
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
