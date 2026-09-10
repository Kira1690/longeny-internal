import { BadRequestError, NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import { type SubmitIntake, isEmptyIntake } from '@longeny/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { intake_submissions } from '../db/schema.js';

const logger = createLogger('intake');

/**
 * RRO intake — the structured answers a classification is derived from.
 *
 * Every method takes the profile id that the profile-context middleware already
 * resolved and ownership-checked against user-provider. Nothing here re-derives
 * scope from the request, and nothing accepts a profile id from a request body:
 * a caller that could name its own scope would not need the ownership check at
 * all.
 */
export class IntakeService {
  /**
   * Store a new intake version for a profile.
   *
   * Submissions are versioned rather than updated. A stored classification
   * points at the version it was derived from, and rewriting that row in place
   * would leave a clinical decision with no visible input.
   *
   * The version is computed inside the insert, so two submissions racing each
   * other cannot both read `max = 1` and both write version 2 — the unique
   * constraint on (profile_id, version) is what actually decides, and the loser
   * retries.
   */
  async submit(profileId: string, authId: string, body: SubmitIntake) {
    // An intake with no symptom, goal or condition carries nothing to reason
    // about: the classifier declines it and the summary declines it, so storing
    // it only creates a versioned clinical record that every consumer refuses.
    // `isEmptyIntake` already encoded this rule but was called only by the
    // classifier, which meant the refusal happened long after the patient had
    // been told their form was accepted. Refuse at the door instead.
    if (isEmptyIntake(body)) {
      throw new BadRequestError('An intake needs at least one symptom, goal or condition');
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [row] = await db
          .insert(intake_submissions)
          .values({
            profile_id: profileId,
            submitted_by_auth_id: authId,
            version: sql`(
              SELECT COALESCE(MAX(version), 0) + 1
              FROM ${intake_submissions}
              WHERE profile_id = ${profileId}
            )`,
            symptoms: body.symptoms,
            goals: body.goals,
            conditions: body.conditions,
            medications: body.medications,
            pillar_priorities: body.pillarPriorities,
            notes: body.notes ?? null,
          })
          .returning();

        logger.info({ profileId, version: row.version }, 'Intake submitted');
        return this.present(row);
      } catch (error) {
        const isVersionRace =
          error instanceof Error && error.message.includes('intake_profile_version_unique');
        if (!isVersionRace || attempt === 2) throw error;
        logger.warn({ profileId, attempt }, 'Intake version race — retrying');
      }
    }
    // Unreachable: the loop either returns or rethrows.
    throw new Error('Intake submission failed after retries');
  }

  /** Latest intake for a profile, or a specific version. */
  async get(profileId: string, version?: number) {
    const where =
      version === undefined
        ? eq(intake_submissions.profile_id, profileId)
        : and(
            eq(intake_submissions.profile_id, profileId),
            eq(intake_submissions.version, version),
          );

    const [row] = await db
      .select()
      .from(intake_submissions)
      .where(where)
      .orderBy(desc(intake_submissions.version))
      .limit(1);

    if (!row) throw new NotFoundError('Intake');
    return this.present(row);
  }

  /** Every version for a profile, newest first — the audit view. */
  async history(profileId: string) {
    const rows = await db
      .select({
        id: intake_submissions.id,
        version: intake_submissions.version,
        submitted_at: intake_submissions.submitted_at,
      })
      .from(intake_submissions)
      .where(eq(intake_submissions.profile_id, profileId))
      .orderBy(desc(intake_submissions.version));
    return rows;
  }

  /**
   * Latest intake in the shape the AI contract expects, or null when the profile
   * has none. Used by the classifier and the summary, which take the answers and
   * never the storage row.
   */
  async latestForContract(profileId: string) {
    const [row] = await db
      .select()
      .from(intake_submissions)
      .where(eq(intake_submissions.profile_id, profileId))
      .orderBy(desc(intake_submissions.version))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      version: row.version,
      intake: {
        symptoms: row.symptoms,
        goals: row.goals,
        conditions: row.conditions,
        medications: row.medications,
        pillarPriorities: row.pillar_priorities,
      },
    };
  }

  /**
   * The submitter's auth id stays out of the response. It identifies the
   * account, not the subject of care, and the client already knows who it is.
   */
  private present(row: typeof intake_submissions.$inferSelect) {
    const { submitted_by_auth_id, ...rest } = row;
    return rest;
  }
}
