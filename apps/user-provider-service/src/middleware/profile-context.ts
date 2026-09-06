import { errorEnvelope } from '@longeny/errors';
import { ACTIVE_PROFILE_HEADER, requestCtx } from '@longeny/middleware';
import { Elysia } from 'elysia';
import type { ProfileService } from '../services/profile.service.js';

// The header name is defined once, in @longeny/middleware, and re-exported here
// so the routes in this service keep their existing import.
export { ACTIVE_PROFILE_HEADER };

/**
 * Resolves which profile a request is acting as, and proves the account may.
 *
 * The model is stateless: `POST /profiles/:id/activate` proves ownership up
 * front, and every later request carries `X-Active-Profile-Id`. The header is
 * client-supplied, so it is never trusted — ownership is re-checked here, on
 * every request, through the same guard the profile routes use.
 *
 * With no header the request acts as the account owner's own `self` profile,
 * which is what a single-profile client sends today.
 *
 * A header naming a profile the account does not own answers 404, never 403 —
 * see ProfileService.assertOwnership.
 */
export const profileContext = (profileService: ProfileService) =>
  new Elysia({ name: 'profile-context' }).onBeforeHandle(
    { as: 'scoped' },
    async ({ request, set }) => {
      const state = requestCtx(request);
      const authId = state.userId;
      if (!authId) return; // requireAuth already refused this request

      const requested = request.headers.get(ACTIVE_PROFILE_HEADER);

      try {
        if (requested) {
          const { profile } = await profileService.assertOwnership(authId, requested);
          state.activeProfileId = profile.id;
        } else {
          state.activeProfileId = await profileService.getSelfProfileId(authId);
        }
      } catch {
        // Either the profile is not this account's, or the account has no
        // profile yet. Both answer the same way, for the same reason.
        set.status = 404;
        return errorEnvelope('NOT_FOUND', 'Profile not found');
      }
    },
  );
