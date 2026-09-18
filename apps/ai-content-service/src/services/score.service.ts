import crypto from 'node:crypto';
import { NotFoundError } from '@longeny/errors';
import { createLogger } from '@longeny/utils';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rro_scores } from '../db/schema.js';
import type { BenchmarkService } from './benchmark.service.js';
import {
  SCORING_VERSION,
  type ScoreResult,
  type ScoringInput,
  score,
} from './benchmark/scoring.js';

const logger = createLogger('rro-score');

type ScoreRow = typeof rro_scores.$inferSelect;

/**
 * Pillar and overall RRO scores (V-W8-5, V-W8-6).
 *
 * Deliberately has no dependency on anything that can change a care state:
 * there is no user-provider client here, no transition call, no event. The
 * advisory rule is enforced by what this class cannot reach, and the E2E suite
 * checks the other side — that no transition row appears.
 */
export class ScoreService {
  constructor(private readonly benchmarks: BenchmarkService) {}

  /** Current inputs, and a fingerprint of exactly what they are. */
  private async inputs(profileId: string) {
    const benchmarked = await this.benchmarks.profileBenchmarks(profileId);
    const inputs: ScoringInput[] = benchmarked.map((b) => ({
      readingId: b.reading.id,
      markerCode: b.marker_code,
      value: b.reading.value,
      status: b.status,
      rangeId: b.range?.id ?? null,
      provisional: b.provisional,
      pillar: b.range?.pillar ?? null,
    }));

    const material = [...benchmarked]
      .sort((a, b) => a.reading.id.localeCompare(b.reading.id))
      .map((b) => [
        b.reading.id,
        b.reading.value,
        b.reading.unit,
        b.range?.id ?? null,
        b.range?.provisional ?? null,
        b.range?.pillar ?? null,
      ]);
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify([SCORING_VERSION, material]))
      .digest('hex');

    return { inputs, fingerprint };
  }

  private present(row: ScoreRow, currentFingerprint: string) {
    return {
      id: row.id,
      profile_id: row.profile_id,
      ...(row.result as ScoreResult),
      computed_at: row.created_at.toISOString(),
      // The readings or ranges behind this score have changed since it was
      // computed, or the scoring rules have.
      stale: row.input_fingerprint !== currentFingerprint,
    };
  }

  private async latestRow(profileId: string) {
    const [row] = await db
      .select()
      .from(rro_scores)
      .where(eq(rro_scores.profile_id, profileId))
      .orderBy(desc(rro_scores.created_at))
      .limit(1);
    return row;
  }

  /**
   * Compute the score now and keep it. If nothing has changed since the last
   * one, the last one is returned rather than a duplicate stored.
   */
  async compute(profileId: string, authId: string) {
    const { inputs, fingerprint } = await this.inputs(profileId);
    const latest = await this.latestRow(profileId);
    if (latest && latest.input_fingerprint === fingerprint) {
      return { created: false, data: this.present(latest, fingerprint) };
    }

    const result = score(inputs);
    const [row] = await db
      .insert(rro_scores)
      .values({
        profile_id: profileId,
        scoring_version: result.scoring_version,
        overall: result.overall === null ? null : String(result.overall),
        result,
        input_fingerprint: fingerprint,
        provisional: result.provisional,
        computed_by_auth_id: authId,
      })
      .returning();

    logger.info(
      { profileId, overall: result.overall, version: result.scoring_version },
      'RRO score computed (advisory)',
    );
    return { created: true, data: this.present(row as ScoreRow, fingerprint) };
  }

  /** The most recent stored score, with whether its inputs have since changed. */
  async latest(profileId: string) {
    const row = await this.latestRow(profileId);
    if (!row) throw new NotFoundError('Score');
    const { fingerprint } = await this.inputs(profileId);
    return this.present(row, fingerprint);
  }
}
