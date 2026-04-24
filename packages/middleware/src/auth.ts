import Elysia from 'elysia';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { UnauthorizedError, ForbiddenError } from '@longeny/errors';
import type { UserRole } from '@longeny/types';

// Lazy singleton Redis client for blacklist checks across all services
let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      host: Bun.env.REDIS_HOST || 'localhost',
      port: Number(Bun.env.REDIS_PORT) || 6379,
      password: Bun.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return _redis;
}

async function isBlacklisted(jti: string, userId: string, issuedAt: number): Promise<boolean> {
  try {
    const redis = getRedis();
    const [jtiHit, invalidateBefore] = await Promise.all([
      redis.get(`blacklist:${jti}`),
      redis.get(`user_invalidated_before:${userId}`),
    ]);
    if (jtiHit !== null) return true;
    if (invalidateBefore !== null && issuedAt < parseInt(invalidateBefore, 10)) return true;
    return false;
  } catch {
    // Redis unavailable — fail open (don't block requests if cache is down)
    return false;
  }
}

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti?: string;
  iat: number;
  exp: number;
}

/**
 * Shared auth store plugin — declares the store shape used by requireAuth,
 * requireRole, requireConsent, etc. Other plugins call .use(authStore()).
 */
export const authStore = () =>
  new Elysia({ name: 'auth-store' })
    .state('userId', '')
    .state('userEmail', '')
    .state('userRole', '' as UserRole);

/**
 * Elysia plugin: extract Bearer token from Authorization header,
 * verify JWT, and store userId/userEmail/userRole on store.
 *
 * Uses onBeforeHandle({ as: 'global' }) so that the lifecycle hook propagates
 * correctly through Elysia v1.4 plugin boundaries. Without 'global', hooks
 * registered in a sub-plugin do not short-circuit the parent app's request
 * lifecycle, and store mutations are not visible to sibling routes.
 */
export const requireAuth = (jwtSecret?: string) =>
  new Elysia({ name: `require-auth-${jwtSecret ?? 'default'}-${crypto.randomUUID()}` })
    .use(authStore())
    .onBeforeHandle({ as: 'scoped' }, async ({ request, store, set }) => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      const token = authHeader.slice(7);
      const secret = jwtSecret || Bun.env.JWT_ACCESS_SECRET;

      if (!secret) {
        set.status = 500;
        return {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'JWT_ACCESS_SECRET is not configured' },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      try {
        const decoded = jwt.verify(token, secret) as JwtPayload;

        // Check Redis blacklist — covers single logout and logout-all
        if (decoded.jti) {
          const blacklisted = await isBlacklisted(decoded.jti, decoded.sub, decoded.iat);
          if (blacklisted) {
            set.status = 401;
            return {
              success: false,
              error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' },
              meta: { timestamp: new Date().toISOString() },
            };
          }
        }

        store.userId = decoded.sub;
        store.userEmail = decoded.email;
        store.userRole = decoded.role;
      } catch (err) {
        set.status = 401;
        if (err instanceof jwt.TokenExpiredError) {
          return {
            success: false,
            error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        return {
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });

/**
 * Elysia plugin: check that the authenticated user has one of the required roles.
 * Must be used after requireAuth() (or use authStore() separately).
 */
export const requireRole = (...roles: UserRole[]) =>
  new Elysia({ name: `require-role-${roles.join('-')}-${crypto.randomUUID()}` })
    .use(authStore())
    .onBeforeHandle({ as: 'scoped' }, ({ store, set }) => {
      const userRole = store.userRole as UserRole | undefined;

      if (!userRole || !roles.includes(userRole)) {
        set.status = 403;
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: `Requires one of roles: ${roles.join(', ')}` },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
