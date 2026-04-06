import Elysia from 'elysia';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@longeny/types';
import { authStore } from '@longeny/middleware';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Like requireAuth but non-blocking: if a valid Bearer token is present,
 * sets userId/userEmail/userRole on store. If absent or invalid, continues
 * without error so public endpoints still work.
 */
export const optionalAuth = (jwtSecret?: string) =>
  new Elysia({ name: `optional-auth-${jwtSecret ?? 'default'}` })
    .use(authStore())
    .onBeforeHandle(({ request, store }) => {
      const authHeader = request.headers.get('Authorization');

      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const secret = jwtSecret || Bun.env.JWT_ACCESS_SECRET;

        if (secret) {
          try {
            const decoded = jwt.verify(token, secret) as JwtPayload;
            store.userId = decoded.sub;
            store.userEmail = decoded.email;
            store.userRole = decoded.role;
          } catch {
            // Token invalid or expired — continue unauthenticated
          }
        }
      }
    });
