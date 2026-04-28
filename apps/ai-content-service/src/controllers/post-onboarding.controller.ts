import { AppError } from '@longeny/errors';
import { PostOnboardingService } from '../services/post-onboarding.service.js';

export class PostOnboardingController {
  constructor(private readonly svc: PostOnboardingService) {}

  async start({
    body,
    store,
  }: {
    body: { onboarding_session_id: string };
    store: { userId: string };
  }) {
    const sessionId = crypto.randomUUID();
    const result = await this.svc.startSession(
      sessionId,
      body.onboarding_session_id,
      store.userId,
    );
    return { success: true, data: result };
  }

  async step({ body }: { body: { session_id: string; answer: string } }) {
    await this.svc.submitAnswer(body.session_id, body.answer);

    const streamUrl = this.svc.streamUrl(body.session_id);
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
}
