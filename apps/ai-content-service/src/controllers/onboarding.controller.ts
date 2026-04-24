import { AppError } from '@longeny/errors';
import { OnboardingAgentService } from '../services/onboarding-agent.service.js';

export class OnboardingController {
  constructor(private readonly agentSvc: OnboardingAgentService) {}

  async start() {
    const result = await this.agentSvc.startSession();
    return { success: true, data: result };
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
