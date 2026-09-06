import { NotFoundError, ServiceUnavailableError } from '@longeny/errors';
import { ServiceCallError, createLogger, createServiceClient } from '@longeny/utils';
import { config } from '../config/index.js';

const logger = createLogger('profile-access');

export interface ResolvedProfile {
  profileId: string;
  accountUserId: string;
  relation: string;
  isSelf: boolean;
  status: string;
}

/**
 * Who may act on a profile's data, asked of the services that know.
 *
 * Profiles live in user-provider's database and bookings in booking's, so this
 * service cannot answer either question with a join. It asks, over HMAC, and
 * both rules therefore keep exactly one implementation.
 *
 * Two distinct questions:
 *
 *  - *Is this profile mine?* — for a patient acting as one of their own
 *    profiles. A profile owned by another account answers 404, never 403.
 *  - *May this provider see this profile?* — for a clinician. True only through
 *    an active booking; there is no ambient provider access to patient data.
 *
 * Nothing is cached. One internal call per request is the cost of not answering
 * "yes" for consent that was revoked thirty seconds ago.
 */
export class ProfileAccessService {
  private readonly userProvider = createServiceClient(
    'ai-content-service',
    config.USER_PROVIDER_SERVICE_URL,
    config.HMAC_SECRET,
  );

  private readonly booking = createServiceClient(
    'ai-content-service',
    config.BOOKING_SERVICE_URL,
    config.HMAC_SECRET,
  );

  /**
   * Resolve the profile an account may act as. No `profileId` means the
   * account owner's own `self` profile.
   *
   * A 404 from user-provider means "not this account's profile" and is raised as
   * NotFoundError. Anything else means the question could not be answered, and
   * that is a 503 — never a quiet "no", which would read to the caller as a
   * missing profile and hide an outage.
   */
  async resolve(authId: string, profileId?: string): Promise<ResolvedProfile> {
    try {
      const response = await this.userProvider.post<{ data: ResolvedProfile }>(
        '/internal/profiles/resolve',
        { authId, profileId },
      );
      return response.data;
    } catch (error) {
      if (error instanceof ServiceCallError && error.status === 404) {
        throw new NotFoundError('Profile');
      }
      logger.error({ error, profileId }, 'Profile resolution failed');
      throw new ServiceUnavailableError('user-provider-service');
    }
  }

  /** Ownership check for a profile named in the path rather than the header. */
  async assertOwns(authId: string, profileId: string): Promise<ResolvedProfile> {
    return this.resolve(authId, profileId);
  }

  /**
   * Whether a provider has an active engagement with a profile.
   *
   * A provider is not the owner of a profile and never resolves it as one. The
   * only basis for access is a booking that exists and has not been cancelled,
   * which booking-service decides.
   *
   * An unanswerable question is a refusal, not an allowance: if booking cannot
   * be reached, the provider does not get the document.
   */
  async providerHasAccess(providerId: string, profileId: string): Promise<boolean> {
    try {
      const response = await this.booking.get<{ data: { hasAccess: boolean } }>(
        `/internal/bookings/access?providerId=${encodeURIComponent(providerId)}&profileId=${encodeURIComponent(profileId)}`,
      );
      return response.data.hasAccess === true;
    } catch (error) {
      logger.error({ error, providerId, profileId }, 'Provider access check failed');
      return false;
    }
  }
}
