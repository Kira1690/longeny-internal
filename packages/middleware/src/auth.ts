import { ForbiddenError, UnauthorizedError } from '@longeny/errors';
import type { UserRole } from '@longeny/types';
import Elysia from 'elysia';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { requestContext, requestCtx } from './request-context.js';

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

/**
 * The client is created with `lazyConnect`, so the first command would
 * otherwise be issued against an idle socket (`enableOfflineQueue: false` makes
 * that throw rather than queue). Under fail-closed that made every service
 * refuse its first authenticated request after boot. Concurrent callers share
 * one connect attempt.
 */
let _connecting: Promise<void> | null = null;

async function connectedRedis(): Promise<Redis> {
  const redis = getRedis();
  if (redis.status === 'ready') return redis;

  if (!_connecting) {
    _connecting = (async () => {
      if (redis.status === 'wait') {
        await redis.connect();
        return;
      }
      if (redis.status === 'connecting' || redis.status === 'connect') {
        await new Promise<void>((resolve, reject) => {
          redis.once('ready', resolve);
          redis.once('error', reject);
        });
      }
    })().finally(() => {
      _connecting = null;
    });
  }

  await _connecting;
  return redis;
}

/** Revocation lookup outcome. `unknown` means Redis could not answer. */
export type RevocationCheck = 'revoked' | 'valid' | 'unknown';

/**
 * Exported so other entry points — the gateway's optional auth, for one — check
 * revocation the same way instead of trusting a signature alone.
 */
export async function checkTokenRevocation(
  jti: string,
  userId: string,
  issuedAt: number,
): Promise<RevocationCheck> {
  try {
    const redis = await connectedRedis();
    const [jtiHit, invalidateBefore] = await Promise.all([
      redis.get(`blacklist:${jti}`),
      redis.get(`user_invalidated_before:${userId}`),
    ]);
    if (jtiHit !== null) return 'revoked';
    if (invalidateBefore !== null && issuedAt < Number.parseInt(invalidateBefore, 10)) {
      return 'revoked';
    }
    return 'valid';
  } catch {
    // Distinguished from 'valid' on purpose: a Redis outage used to be
    // indistinguishable from a clean lookup, so a revoked token was honoured
    // for the rest of its lifetime with nothing in the logs. The caller decides
    // what an unknown answer means for the route it guards.
    return 'unknown';
  }
}

interface JwtPayload {
  sub: string;
  email: string;
  /** Highest-privilege role. Present on every token. */
  role: UserRole;
  /** Every role held. Absent on tokens issued before multi-role support. */
  roles?: UserRole[];
  /** Permission names granted by those roles. */
  permissions?: string[];
  jti?: string;
  iat: number;
  exp: number;
}

export interface RequireAuthOptions {
  /** Secret override. Defaults to `JWT_ACCESS_SECRET`. */
  jwtSecret?: string;
  /**
   * What to do when the revocation store cannot be reached.
   * `'closed'` refuses the request — use it on any route that touches health
   * data, where honouring a revoked token is worse than a short outage.
   * `'open'` allows it. Defaults to `'open'` to preserve existing behaviour on
   * routes that have not made the call yet.
   */
  onRevocationCheckFailure?: 'open' | 'closed';
}

/**
 * Shared request-scoped store used by requireAuth, requireRole,
 * requirePermission, requireConsent and everything downstream.
 *
 * Kept as a named export because every guard in the repo composes it. It now
 * delegates to `requestContext()`, which is per request — see that file for why
 * `.state()` could not stay.
 */
export const authStore = requestContext;

function authError(code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Elysia plugin: extract Bearer token from Authorization header, verify the
 * JWT, check revocation, and put identity on the store.
 *
 * Accepts either a bare secret (legacy call sites) or an options object.
 *
 * Uses onBeforeHandle({ as: 'scoped' }) so the lifecycle hook propagates
 * correctly through Elysia v1.4 plugin boundaries. Without a scope, hooks
 * registered in a sub-plugin do not short-circuit the parent app's request
 * lifecycle, and store mutations are not visible to sibling routes.
 */
export const requireAuth = (options?: string | RequireAuthOptions) => {
  const opts: RequireAuthOptions =
    typeof options === 'string' ? { jwtSecret: options } : (options ?? {});
  const failureMode = opts.onRevocationCheckFailure ?? 'open';

  return new Elysia({
    name: `require-auth-${opts.jwtSecret ?? 'default'}-${failureMode}-${crypto.randomUUID()}`,
  })
    .use(authStore())
    .onBeforeHandle({ as: 'scoped' }, async ({ request, set }) => {
      const identity = requestCtx(request);
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return authError('UNAUTHORIZED', 'Missing or invalid Authorization header');
      }

      const token = authHeader.slice(7);
      const secret = opts.jwtSecret || Bun.env.JWT_ACCESS_SECRET;

      if (!secret) {
        set.status = 500;
        return authError('INTERNAL_ERROR', 'JWT_ACCESS_SECRET is not configured');
      }

      try {
        const decoded = jwt.verify(token, secret) as JwtPayload;

        // Revocation check — covers single logout and logout-all
        if (decoded.jti) {
          const revocation = await checkTokenRevocation(decoded.jti, decoded.sub, decoded.iat);
          if (revocation === 'revoked') {
            set.status = 401;
            return authError('TOKEN_REVOKED', 'Token has been revoked');
          }
          if (revocation === 'unknown' && failureMode === 'closed') {
            set.status = 503;
            return authError(
              'REVOCATION_CHECK_UNAVAILABLE',
              'Cannot verify token status right now. Please retry.',
            );
          }
        }

        identity.userId = decoded.sub;
        identity.userEmail = decoded.email;
        identity.userRole = decoded.role;
        // Tokens issued before multi-role support carry only `role`.
        identity.userRoles = decoded.roles?.length ? decoded.roles : [decoded.role];
        identity.userPermissions = decoded.permissions ?? [];
      } catch (err) {
        set.status = 401;
        if (err instanceof jwt.TokenExpiredError) {
          return authError('TOKEN_EXPIRED', 'Token has expired');
        }
        return authError('INVALID_TOKEN', 'Invalid token');
      }
    });
};

/**
 * Elysia plugin: check that the authenticated user holds at least one of the
 * required roles. Checks every role on the token, not just the primary one.
 * Must be used after requireAuth() (or use authStore() separately).
 */
export const requireRole = (...roles: UserRole[]) =>
  new Elysia({ name: `require-role-${roles.join('-')}-${crypto.randomUUID()}` })
    .use(authStore())
    .onBeforeHandle({ as: 'scoped' }, ({ request, set }) => {
      const { userRoles, userRole } = requestCtx(request);
      const held = userRoles.length ? userRoles : userRole ? [userRole] : [];

      if (!held.some((role) => roles.includes(role))) {
        set.status = 403;
        return authError('FORBIDDEN', `Requires one of roles: ${roles.join(', ')}`);
      }
    });

/**
 * Elysia plugin: check that the authenticated user holds every listed
 * permission. Roles are the coarse gate; permissions are the fine one.
 *
 * Permissions come from the `role_permissions` table via the token, so removing
 * a permission takes effect on the user's next token refresh.
 *
 * This never answers "may this actor touch *this row*" — that check belongs in
 * the service layer next to the query, and is required in addition to this one.
 */
export const requirePermission = (...required: string[]) =>
  new Elysia({ name: `require-permission-${required.join('-')}-${crypto.randomUUID()}` })
    .use(authStore())
    .onBeforeHandle({ as: 'scoped' }, permissionGuard(...required));

/**
 * The same check as a bare handler, for routes that need a different permission
 * per route inside one authenticated group: pass it as the route's
 * `beforeHandle`. One implementation backs both forms.
 */
export function permissionGuard(...required: string[]) {
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    const held = new Set(requestCtx(request).userPermissions);
    const missing = required.filter((permission) => !held.has(permission));

    if (missing.length > 0) {
      set.status = 403;
      return authError('FORBIDDEN', `Requires permission: ${missing.join(', ')}`);
    }
  };
}
