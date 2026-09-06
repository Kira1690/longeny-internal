import { errorEnvelope } from '@longeny/errors';
import { ServiceCallError, createServiceClient } from '@longeny/utils';
import Elysia from 'elysia';
import { ACTIVE_PROFILE_HEADER, requestCtx } from './request-context.js';

/** Header the client sends to act as one of its own profiles. */
export { ACTIVE_PROFILE_HEADER };

export interface ResolvedProfile {
  profileId: string;
  accountUserId: string;
  relation: string;
  isSelf: boolean;
  status: string;
}

export interface RemoteProfileContextOptions {
  /** Calling service's own name — sent as X-Service-Name on the resolve call. */
  serviceName: string;
  /** Base URL of user-provider-service, which owns `profiles`. */
  userProviderUrl: string;
  hmacSecret: string;
  /**
   * How hard the profile is required.
   *
   * `required` (default) — every request resolves a profile, falling back to the
   * account owner's own. Use it where the data *is* about a subject of care and
   * a query with no profile would be meaningless or unscoped: intake, clinical
   * records, onboarding.
   *
   * `header-only` — resolve only when the caller sent `X-Active-Profile-Id`, and
   * otherwise leave the context empty. Use it where the profile is recorded but
   * is not the scope: a booking and an order belong to the account that paid,
   * and they carry a profile so a family can see who a session was for.
   *
   * The distinction matters for more than tidiness. Under `required`, every
   * request in the service depends on user-provider being reachable, and a
   * provider — who owns no profiles at all — cannot use the service. Payments
   * must not stop because the profile service is restarting.
   *
   * A header that names a profile the account does not own is refused in both
   * modes. That is an authorisation decision, not a convenience.
   */
  mode?: 'required' | 'header-only';
}

/**
 * Resolves which profile a request acts as, for a service that does not own the
 * `profiles` table.
 *
 * user-provider has `profileContext`, which asks its own database. Every other
 * service holds profile-scoped rows in a separate database and cannot join to
 * `profiles`, so it asks user-provider over HMAC instead. The rule that decides
 * who may act as a profile therefore exists once, in `ProfileService.assertOwnership`.
 *
 * The header is client-supplied and never trusted: ownership is re-checked on
 * every request, and a profile the account does not own answers 404 — never 403,
 * which would confirm the profile exists.
 *
 * **Nothing here is cached.** One internal call per request is the cost. A cache
 * of even thirty seconds would keep answering "yes" for a profile whose consent
 * was revoked twenty-nine seconds ago, and this decides access to health data.
 *
 * A resolve call that fails for any reason other than 404 fails the request
 * closed with 503. Proceeding would run the handler with an empty
 * `activeProfileId`, and a query scoped to an empty profile is a query scoped to
 * nothing — which, depending on how the handler is written, is either an error
 * or every row in the table.
 */
export const remoteProfileContext = (options: RemoteProfileContextOptions) => {
  const client = createServiceClient(
    options.serviceName,
    options.userProviderUrl,
    options.hmacSecret,
  );

  return new Elysia({ name: 'remote-profile-context' }).onBeforeHandle(
    { as: 'scoped' },
    async ({ request, set }) => {
      const state = requestCtx(request);
      if (!state.userId) return; // requireAuth already refused this request

      const requested = request.headers.get(ACTIVE_PROFILE_HEADER) ?? undefined;

      // Nothing to resolve, and nothing that needs resolving.
      if (!requested && options.mode === 'header-only') return;

      try {
        const response = await client.post<{ data: ResolvedProfile }>(
          '/internal/profiles/resolve',
          { authId: state.userId, profileId: requested },
        );
        state.activeProfileId = response.data.profileId;
      } catch (error) {
        if (error instanceof ServiceCallError && error.status === 404) {
          set.status = 404;
          return errorEnvelope('NOT_FOUND', 'Profile not found');
        }
        set.status = 503;
        return errorEnvelope('SERVICE_UNAVAILABLE', 'Profile context could not be established');
      }
    },
  );
};
