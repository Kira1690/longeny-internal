import { AppError } from '@longeny/errors';
import { createLogger, createServiceClient } from '@longeny/utils';
import { config } from '../config/index.js';
import { OnboardingAgentService } from '../services/onboarding-agent.service.js';

const logger = createLogger('ai-content:onboarding');
const userProviderClient = createServiceClient(
  'ai-content-service',
  Bun.env.USER_PROVIDER_SERVICE_URL || 'http://localhost:3002',
  config.HMAC_SECRET,
);

export class OnboardingController {
  constructor(private readonly agentSvc: OnboardingAgentService) {}

  async start({ store }: { store: { userId: string } }) {
    // Greet the patient by their account name (best-effort — falls back to asking if unavailable).
    const name = await this.fetchFirstName(store.userId);
    const result = await this.agentSvc.startSession({ userId: store.userId, name });
    return { success: true, data: result };
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

  async step({ body }: { body: { session_id: string; answer: string } }) {
    const { session_id, answer } = body;
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

  async getSession({ params }: { params: { id: string } }) {
    const state = await this.agentSvc.getSession(params.id);
    if (!state) {
      throw new AppError('Session not found or not yet complete', 404, 'NOT_FOUND');
    }
    return { success: true, data: state };
  }
}
