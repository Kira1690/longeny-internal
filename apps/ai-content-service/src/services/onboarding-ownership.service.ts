import { NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { onboarding_sessions } from '../db/schema.js';

const logger = createLogger('onboarding-ownership');

/**
 * Ownership and profile scope for AI onboarding sessions.
 *
 * The conversation lives in the Python agent, which knows a session id and
 * nothing about accounts or profiles. This service is the record of who started
 * a session and who it is about — without it, a session id is a bearer token for
 * someone else's symptoms.
 *
 * Reads answer 404 for a session that belongs to another account, the same as
 * for one that does not exist: a 403 would confirm the id is real.
 */
export class OnboardingOwnershipService {
  /** Record a session as belonging to an account and being about a profile. */
  async claim(sessionId: string, authId: string, profileId: string) {
    const [row] = await db
      .insert(onboarding_sessions)
      .values({ session_id: sessionId, auth_id: authId, profile_id: profileId })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      // The agent reused an id we have already claimed. Not fatal, but it means
      // two conversations could share an ownership record — worth seeing.
      logger.warn({ sessionId }, 'Onboarding session id was already claimed');
    }
    return row ?? null;
  }

  /**
   * The session, if this account owns it.
   *
   * Sessions started before this record existed have no row, so they are not
   * readable by anyone — which is the safe direction. They stay in the agent and
   * expire with it.
   */
  async assertOwned(sessionId: string, authId: string) {
    const [row] = await db
      .select()
      .from(onboarding_sessions)
      .where(
        and(eq(onboarding_sessions.session_id, sessionId), eq(onboarding_sessions.auth_id, authId)),
      )
      .limit(1);

    if (!row) throw new NotFoundError('Session');
    return row;
  }

  /** Which profile a session is about, for the completion event. Null if unknown. */
  async profileFor(sessionId: string): Promise<string | null> {
    const [row] = await db
      .select({ profile_id: onboarding_sessions.profile_id })
      .from(onboarding_sessions)
      .where(eq(onboarding_sessions.session_id, sessionId))
      .limit(1);
    return row?.profile_id ?? null;
  }

  /** Sessions this account started, newest first. */
  async listForAccount(authId: string) {
    return db
      .select()
      .from(onboarding_sessions)
      .where(eq(onboarding_sessions.auth_id, authId))
      .orderBy(desc(onboarding_sessions.created_at))
      .limit(50);
  }

  async markComplete(sessionId: string) {
    await db
      .update(onboarding_sessions)
      .set({ completed_at: new Date() })
      .where(eq(onboarding_sessions.session_id, sessionId));
  }
}
