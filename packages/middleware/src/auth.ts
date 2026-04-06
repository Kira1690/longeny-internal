import Elysia from 'elysia';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '@longeny/errors';
import type { UserRole } from '@longeny/types';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
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
 */
export const requireAuth = (jwtSecret?: string) =>
  new Elysia({ name: `require-auth-${jwtSecret ?? 'default'}` })
    .use(authStore())
    .onBeforeHandle(async ({ request, store, error }) => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return error(401, {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
        });
      }

      const token = authHeader.slice(7);
      const secret = jwtSecret || Bun.env.JWT_ACCESS_SECRET;

      if (!secret) {
        return error(500, {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'JWT_ACCESS_SECRET is not configured' },
        });
      }

      try {
        const decoded = jwt.verify(token, secret) as JwtPayload;
        store.userId = decoded.sub;
        store.userEmail = decoded.email;
        store.userRole = decoded.role;
      } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
          return error(401, {
            success: false,
            error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' },
          });
        }
        return error(401, {
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' },
        });
      }
    });

/**
 * Elysia plugin: check that the authenticated user has one of the required roles.
 * Must be used after requireAuth() (or use authStore() separately).
 */
export const requireRole = (...roles: UserRole[]) =>
  new Elysia({ name: `require-role-${roles.join('-')}` })
    .use(authStore())
    .onBeforeHandle(({ store, error }) => {
      const userRole = store.userRole as UserRole | undefined;

      if (!userRole || !roles.includes(userRole)) {
        return error(403, {
          success: false,
          error: { code: 'FORBIDDEN', message: `Requires one of roles: ${roles.join(', ')}` },
        });
      }
    });
