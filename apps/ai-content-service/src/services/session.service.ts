import { AppError } from '@longeny/errors';
import { config } from '../config/index.js';

const BASE = config.AI_AGENT_URL;

export interface SessionSummary {
  session_id: string;
  name: string | null;
  turn_number: number;
  is_complete: boolean;
}

export interface SessionDetail extends SessionSummary {
  user_id: string;
  input_language: string;
  final_payload: Record<string, unknown> | null;
}

export class SessionService {
  async createSession(userId: string): Promise<{ session_id: string; first_question: string }> {
    const res = await fetch(`${BASE}/ai/onboarding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new AppError('Failed to create session', 502, 'AGENT_ERROR');
    return res.json() as Promise<{ session_id: string; first_question: string }>;
  }

  async getUserHistory(userId: string): Promise<SessionSummary[]> {
    const res = await fetch(`${BASE}/ai/onboarding/history/${userId}`);
    if (!res.ok) throw new AppError('Failed to fetch history', 502, 'AGENT_ERROR');
    return res.json() as Promise<SessionSummary[]>;
  }

  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const res = await fetch(`${BASE}/ai/onboarding/finalize/${sessionId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError('Failed to fetch session', 502, 'AGENT_ERROR');
    const payload = await res.json();
    return {
      session_id: sessionId,
      name: null,
      turn_number: 0,
      is_complete: true,
      user_id: '',
      input_language: 'en',
      final_payload: payload as Record<string, unknown>,
    };
  }
}
