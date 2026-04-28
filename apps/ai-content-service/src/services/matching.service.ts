import { config } from '../config/index.js';
import { AppError } from '@longeny/errors';

const BASE = config.AI_AGENT_URL;

export interface MatchedProvider {
  provider_id: string;
  name: string;
  specialties: string[];
  score: number;
  score_breakdown: Record<string, number>;
  consultation_modes: string[];
  city: string;
  hourly_rate_inr: number;
  rating: number;
  years_experience: number;
}

export interface MatchResult {
  match_id: string;
  session_id: string;
  providers: MatchedProvider[];
  total_providers_scanned: number;
  created_at: string;
}

export class MatchingService {
  async match(sessionId: string, userId: string): Promise<MatchResult> {
    const res = await fetch(`${BASE}/ai/provider/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, user_id: userId }),
    });
    if (!res.ok) throw new AppError('Matching failed', 502, 'AGENT_ERROR');
    return res.json() as Promise<MatchResult>;
  }

  async getMatchResult(matchId: string): Promise<MatchResult | null> {
    const res = await fetch(`${BASE}/ai/provider/match/${matchId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError('Failed to fetch match', 502, 'AGENT_ERROR');
    return res.json() as Promise<MatchResult>;
  }
}
