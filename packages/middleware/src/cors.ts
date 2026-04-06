import Elysia from 'elysia';

/**
 * Elysia CORS plugin with configurable allowed origins.
 * Also registers an OPTIONS handler for preflight requests.
 */
export const corsMiddleware = (origins: string[]) =>
  new Elysia({ name: 'cors-middleware' })
    .onRequest(({ request, set }) => {
      const origin = request.headers.get('Origin');

      if (origin && origins.includes(origin)) {
        set.headers['Access-Control-Allow-Origin'] = origin;
        set.headers['Vary'] = 'Origin';
      }

      set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
      set.headers['Access-Control-Allow-Headers'] =
        'Content-Type, Authorization, X-Correlation-ID, X-Service-Name, X-Timestamp, X-Signature';
      set.headers['Access-Control-Allow-Credentials'] = 'true';
      set.headers['Access-Control-Max-Age'] = '86400';
    })
    .options('/*', ({ set }) => {
      set.status = 204;
      return '';
    });
