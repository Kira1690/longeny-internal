import { config } from '../config/index.js';
import { AppError } from '@longeny/errors';

const BASE = config.AI_AGENT_URL;

export class PostOnboardingService {
  async startSession(
    sessionId: string,
    onboardingSessionId: string,
    userId: string = '',
  ): Promise<{ session_id: string; first_message: string }> {
    const res = await fetch(`${BASE}/ai/post-onboarding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        onboarding_session_id: onboardingSessionId,
        user_id: userId,
      }),
    });
    if (!res.ok) throw new AppError('Failed to start post-onboarding', 502, 'AGENT_ERROR');
    return res.json() as Promise<{ session_id: string; first_message: string }>;
  }

  async submitAnswer(sessionId: string, answer: string): Promise<void> {
    const res = await fetch(`${BASE}/ai/post-onboarding/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, answer }),
    });
    if (!res.ok) throw new AppError('Failed to submit answer', 502, 'AGENT_ERROR');
  }

  streamUrl(sessionId: string): string {
    return `${BASE}/ai/post-onboarding/stream/${sessionId}`;
  }
}
