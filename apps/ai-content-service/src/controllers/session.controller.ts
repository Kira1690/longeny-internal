import { AppError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import type { OnboardingOwnershipService } from '../services/onboarding-ownership.service.js';
import type { SessionService } from '../services/session.service.js';

/**
 * Onboarding session history.
 *
 * The agent stores the conversation; this service stores who it belongs to.
 * Both reads go through the ownership record, so a session id from another
 * account is indistinguishable from one that does not exist.
 */
export class SessionController {
  constructor(
    private readonly sessionSvc: SessionService,
    private readonly ownership: OnboardingOwnershipService,
  ) {}

  async start({ store }: { store: RequestContext }) {
    const result = await this.sessionSvc.createSession(store.userId);
    await this.ownership.claim(result.session_id, store.userId, store.activeProfileId);
    return { success: true, data: { ...result, profile_id: store.activeProfileId } };
  }

  /**
   * Sessions this account started.
   *
   * Listed from the ownership record rather than from the agent: the agent keys
   * history by the user id it was handed, and it has no way to prove that id
   * belongs to the caller.
   */
  async history({ store }: { store: RequestContext }) {
    const sessions = await this.ownership.listForAccount(store.userId);
    return { success: true, data: sessions };
  }

  async getSession({ params, store }: { params: { id: string }; store: RequestContext }) {
    const owned = await this.ownership.assertOwned(params.id, store.userId);
    const session = await this.sessionSvc.getSession(params.id);
    if (!session) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }
    return { success: true, data: { ...session, profile_id: owned.profile_id } };
  }
}
