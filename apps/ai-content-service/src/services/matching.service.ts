import { AppError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import { config } from '../config/index.js';
import { publishPatientOnboardingCompleted } from '../events/publishers.js';
import type { OnboardingOwnershipService } from './onboarding-ownership.service.js';

const BASE = config.AI_AGENT_URL;
const logger = createLogger('ai-content:matching');

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
  constructor(private readonly ownership: OnboardingOwnershipService) {}

  async match(sessionId: string, userId: string): Promise<MatchResult> {
    const res = await fetch(`${BASE}/ai/provider/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, user_id: userId }),
    });
    if (!res.ok) throw new AppError('Matching failed', 502, 'AGENT_ERROR');
    const result = (await res.json()) as MatchResult;

    // Persist the completed onboarding to the patient's durable profile. The AI agent keeps
    // the intake only in Redis (7-day TTL); without this the health data is lost when the
    // session expires or the patient revisits their profile. Best-effort: a persistence
    // failure must never break matching.
    void this.persistOnboarding(sessionId, userId);

    return result;
  }

  /**
   * Fetch the finalize payload and emit patient.onboarding.completed for durable
   * persistence.
   *
   * The event carries the profile the session was started for. Without it the
   * subscriber wrote every completed onboarding onto the account owner's own
   * profile, so a session filled in for a parent landed on the wrong person.
   */
  private async persistOnboarding(sessionId: string, authId: string): Promise<void> {
    try {
      const res = await fetch(`${BASE}/ai/onboarding/finalize/${sessionId}`);
      if (!res.ok) {
        logger.warn(
          { sessionId, status: res.status },
          'Could not fetch final payload for persistence',
        );
        return;
      }
      const finalPayload = (await res.json()) as Record<string, unknown>;
      if (!finalPayload || typeof finalPayload !== 'object') return;
      const profileId = await this.ownership.profileFor(sessionId);
      await publishPatientOnboardingCompleted({
        authId,
        sessionId,
        finalPayload,
        ...(profileId ? { profileId } : {}),
      });
      await this.ownership.markComplete(sessionId);
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to publish onboarding-completed event');
    }
  }

  async getMatchResult(matchId: string): Promise<MatchResult | null> {
    const res = await fetch(`${BASE}/ai/provider/match/${matchId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError('Failed to fetch match', 502, 'AGENT_ERROR');
    return res.json() as Promise<MatchResult>;
  }
}
