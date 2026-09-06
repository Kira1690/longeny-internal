import { AppError } from '@longeny/errors';
import type { RequestContext } from '@longeny/middleware';
import { createLogger, createServiceClient } from '@longeny/utils';
import { config } from '../config/index.js';
import type { OnboardingAgentService } from '../services/onboarding-agent.service.js';
import type { OnboardingOwnershipService } from '../services/onboarding-ownership.service.js';

const logger = createLogger('ai-content:onboarding');
// Validated config rather than a raw env read: a typo in the URL used to fail
// at request time, on a call whose failure is swallowed.
const userProviderClient = createServiceClient(
  'ai-content-service',
  config.USER_PROVIDER_SERVICE_URL,
  config.HMAC_SECRET,
);

export class OnboardingController {
  constructor(
    private readonly agentSvc: OnboardingAgentService,
    private readonly ownership: OnboardingOwnershipService,
  ) {}

  /**
   * Start a session for the profile this request is acting as.
   *
   * The agent knows only a session id; the ownership row written here is what
   * ties that id to an account and a subject of care. Without it the session is
   * readable by anyone who guesses the id, and its answers persist to whoever
   * happens to be the account owner rather than to the person they are about.
   */
  async start({ store }: { store: RequestContext }) {
    // Greet the patient by their account name (best-effort — falls back to asking if unavailable).
    const name = await this.fetchFirstName(store.userId);
    const result = await this.agentSvc.startSession({ userId: store.userId, name });
    await this.ownership.claim(result.session_id, store.userId, store.activeProfileId);
    return { success: true, data: { ...result, profile_id: store.activeProfileId } };
  }

  private async fetchFirstName(userId: string): Promise<string | undefined> {
    try {
      const res = await userProviderClient.get<{ data?: { first_name?: string } }>(
        `/internal/users/by-auth/${userId}`,
      );
      return res.data?.first_name || undefined;
    } catch (error) {
      logger.warn({ userId, error }, 'Could not fetch account name for onboarding greeting');
      return undefined;
    }
  }

  async step({
    body,
    store,
  }: { body: { session_id: string; answer: string }; store: RequestContext }) {
    const { session_id, answer } = body;
    // Answers are appended to a conversation that carries health data — the
    // caller has to own it.
    await this.ownership.assertOwned(session_id, store.userId);
    await this.agentSvc.submitAnswer(session_id, answer);

    const streamUrl = this.agentSvc.streamUrl(session_id);
    const upstream = await fetch(streamUrl, {
      headers: { Accept: 'text/event-stream' },
    });

    if (!upstream.ok || !upstream.body) {
      throw new AppError('Agent stream unavailable', 502, 'INTERNAL_ERROR');
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  async getSession({ params, store }: { params: { id: string }; store: RequestContext }) {
    // A session transcript carries symptoms and conditions. Another account's
    // session answers 404, exactly like one that does not exist.
    const owned = await this.ownership.assertOwned(params.id, store.userId);
    const state = await this.agentSvc.getSession(params.id);
    if (!state) {
      throw new AppError('Session not found or not yet complete', 404, 'NOT_FOUND');
    }
    return { success: true, data: { ...state, profile_id: owned.profile_id } };
  }
}
