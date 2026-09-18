import type { UserRole } from '@longeny/types';
import Elysia from 'elysia';

/**
 * Per-request state for the whole middleware stack.
 *
 * Elysia's `.state()` store is a **singleton per instance**, not per request.
 * Identity written there by one request is visible to — and overwritten by —
 * every other request in flight. Under ordinary concurrent traffic that made one
 * account read and write another account's data: no auth bypass, just two users
 * whose requests overlapped.
 *
 * The state is therefore keyed on the `Request` object itself. A WeakMap is
 * immune to how Elysia merges context across plugin boundaries — which is what
 * made two earlier attempts (a scoped `derive` shadowing `store`, then the same
 * derive nested inside the guard plugin) silently fail: hooks in a nested plugin
 * kept writing to the shared object even while handlers read the derived one.
 *
 * Middleware reads and writes it through `requestCtx(request)`. Route handlers
 * keep reading `store.userId` as before: the plugin's `derive` hands them this
 * same object, so no consumer had to change.
 *
 * Entries die with the Request — nothing to clean up.
 */
/**
 * The header a client sends to act for one of its profiles.
 *
 * It names a contract, not a transport detail: both the local profile-context
 * middleware and the cross-service resolver read the same header, so the name
 * lives beside the request state they both populate.
 */
export const ACTIVE_PROFILE_HEADER = 'X-Active-Profile-Id';

export interface RequestContext {
  /** Authenticated account — the JWT `sub` (auth_id). Empty until requireAuth runs. */
  userId: string;
  userEmail: string;
  /** Highest-privilege role held. */
  userRole: UserRole;
  /** Every role on the token. */
  userRoles: UserRole[];
  userPermissions: string[];
  /** Subject of care this request acts as. Set by the profile-context middleware. */
  activeProfileId: string;
  /** Calling service on an HMAC-signed internal request. */
  serviceName: string;
  /** Raw request body, captured at parse time so the signature covers what was sent. */
  rawBody: string;
  correlationId: string;
  requestStartTime: number;
  auditStartTime: number;
  /**
   * Subject of care an audited request touched, set by a handler that only
   * learns it after loading the resource (a report named by its own id).
   */
  auditProfileId: string;
}

const contexts = new WeakMap<Request, RequestContext>();

/** The calling request's own state. Created on first use, shared for that request only. */
export function requestCtx(request: Request): RequestContext {
  let existing = contexts.get(request);
  if (!existing) {
    existing = {
      userId: '',
      userEmail: '',
      userRole: '' as UserRole,
      userRoles: [],
      userPermissions: [],
      activeProfileId: '',
      serviceName: '',
      rawBody: '',
      correlationId: '',
      requestStartTime: 0,
      auditStartTime: 0,
      auditProfileId: '',
    };
    contexts.set(request, existing);
  }
  return existing;
}

/**
 * Exposes the request's own state to route handlers as `store`.
 *
 * Must be applied at the top level of each service's app, not only inside a
 * guard: a scoped derive registered in a nested plugin does not reach the
 * parent's routes, and a handler that misses it would read the shared store.
 *
 * The `.state()` calls below exist for their TYPES only. At runtime the derive
 * shadows them with the request's own object, but Elysia's `Singleton['store']`
 * type comes from `.state()`, so without them a handler cannot declare
 * `store: RequestContext` and every typed handler reports TS2345.
 *
 * Nothing may write to the shared values — middleware goes through
 * `requestCtx(request)`, which is why these stay at their zero values for the
 * life of the process.
 */
export const requestContext = () =>
  new Elysia({ name: 'request-context' })
    .state('userId', '')
    .state('userEmail', '')
    .state('userRole', '' as UserRole)
    .state('userRoles', [] as UserRole[])
    .state('userPermissions', [] as string[])
    .state('activeProfileId', '')
    .state('serviceName', '')
    .state('rawBody', '')
    .state('correlationId', '')
    .state('requestStartTime', 0)
    .state('auditStartTime', 0)
    .state('auditProfileId', '')
    .derive({ as: 'scoped' }, ({ request }): { store: RequestContext } => ({
      store: requestCtx(request),
    }));
