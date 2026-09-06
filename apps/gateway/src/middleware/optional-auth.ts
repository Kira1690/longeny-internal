import { checkTokenRevocation, requestCtx } from '@longeny/middleware';
import type { UserRole } from '@longeny/types';
import Elysia from 'elysia';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  roles?: UserRole[];
  permissions?: string[];
  jti?: string;
  iat: number;
  exp: number;
}

/**
 * Like requireAuth but non-blocking: a valid Bearer token populates the
 * request's identity, and an absent or invalid one simply continues
 * unauthenticated so public endpoints still work.
 *
 * A *revoked* token is not treated as valid. Signature verification alone would
 * accept a token whose session has been logged out, and these routes personalise
 * their response for whoever the token names.
 */
export const optionalAuth = (jwtSecret?: string) =>
  new Elysia({ name: `optional-auth-${jwtSecret ?? 'default'}` }).onBeforeHandle(
    { as: 'scoped' },
    async ({ request }) => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return;

      const secret = jwtSecret || Bun.env.JWT_ACCESS_SECRET;
      if (!secret) return;

      try {
        const decoded = jwt.verify(authHeader.slice(7), secret) as JwtPayload;

        if (decoded.jti) {
          const revocation = await checkTokenRevocation(decoded.jti, decoded.sub, decoded.iat);
          // 'unknown' means Redis could not answer. These routes are public with
          // personalisation, so an outage degrades to anonymous rather than
          // failing the request — the opposite call from the health-data routes.
          if (revocation !== 'valid') return;
        }

        const identity = requestCtx(request);
        identity.userId = decoded.sub;
        identity.userEmail = decoded.email;
        identity.userRole = decoded.role;
        identity.userRoles = decoded.roles?.length ? decoded.roles : [decoded.role];
        identity.userPermissions = decoded.permissions ?? [];
      } catch {
        // Token invalid or expired — continue unauthenticated
      }
    },
  );
