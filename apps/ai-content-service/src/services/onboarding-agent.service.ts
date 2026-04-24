import { config } from '../config/index.js';

const BASE = config.AI_AGENT_URL;

export interface SessionStartResult {
  session_id: string;
  first_question: string;
}

export interface SessionState {
  session_id: string;
  turn_number: number;
  is_complete: boolean;
  final_payload: Record<string, unknown> | null;
}

export class OnboardingAgentService {
  async startSession(): Promise<SessionStartResult> {
    const res = await fetch(`${BASE}/ai/onboarding/session`, { method: 'POST' });
    if (!res.ok) throw new Error(`Agent /session failed: ${res.status}`);
    return res.json() as Promise<SessionStartResult>;
  }

  async submitAnswer(sessionId: string, answer: string): Promise<void> {
    const res = await fetch(`${BASE}/ai/onboarding/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, answer }),
    });
    if (!res.ok) throw new Error(`Agent /answer failed: ${res.status}`);
  }

  streamUrl(sessionId: string): string {
    return `${BASE}/ai/onboarding/stream/${sessionId}`;
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    const res = await fetch(`${BASE}/ai/onboarding/finalize/${sessionId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Agent /finalize failed: ${res.status}`);
    const payload = await res.json();
    return {
      session_id: sessionId,
      turn_number: 0,
      is_complete: true,
      final_payload: payload as Record<string, unknown>,
    };
  }
}
