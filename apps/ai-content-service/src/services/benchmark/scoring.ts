import { type BenchmarkStatus, RRO_PILLARS, type RroPillar } from '@longeny/types';

/**
 * Pillar and overall RRO scores.
 *
 * Pure and versioned. A score names the rule set that produced it, and the
 * same inputs under the same version always give the same number, so a
 * stored score can always be recomputed from stored readings
 * and match exactly.
 *
 * **The numbers below are placeholders.** How many points a verdict is worth,
 * and how much each pillar counts towards the overall score, is a clinical
 * decision that has not been made yet. Until it is, every score this produces
 * is marked provisional, and replacing the tables is a new `SCORING_VERSION`
 * rather than an edit, so a score computed under the old rules still says so.
 *
 * **A score is advisory.** Nothing here, and nothing that calls this, moves a
 * patient between care stages. A lab panel looks objective, which is exactly
 * why an automatic transition driven by it would be trusted without anyone
 * looking; the decision stays with a clinician.
 */

export const SCORING_VERSION = 'placeholder-2026-09.1';

/** True while the tables below are placeholders. */
export const SCORING_IS_PLACEHOLDER = true;

/** Points per verdict. Verdicts without a reference are not scored at all. */
const VERDICT_POINTS: Record<'optimal' | 'normal' | 'low' | 'high', number> = {
  optimal: 100,
  normal: 70,
  low: 30,
  high: 30,
};

/** Each pillar's share of the overall score. Equal until decided. */
const PILLAR_WEIGHTS: Record<RroPillar, number> = {
  nutrition: 1,
  movement: 1,
  sleep: 1,
  stress: 1,
  environment: 1,
};

export interface ScoringInput {
  readingId: string;
  markerCode: string;
  value: number;
  /** The benchmark verdict for this reading. */
  status: BenchmarkStatus;
  rangeId: string | null;
  /** The verdict was reached against a placeholder range. */
  provisional: boolean;
  /** From the range. A marker with no pillar feeds no pillar. */
  pillar: RroPillar | null;
}

export interface Contribution {
  reading_id: string;
  marker_code: string;
  value: number;
  status: string;
  range_id: string | null;
  points: number | null;
  /** Why a reading did not count, when it did not. */
  excluded_reason: 'no_reference' | 'unit_mismatch' | 'no_pillar' | null;
}

export interface PillarScore {
  pillar: RroPillar;
  /** 0–100, or null when no reading in this pillar could be scored. */
  score: number | null;
  scored_markers: number;
  contributions: Contribution[];
}

export interface ScoreResult {
  scoring_version: string;
  /** 0–100, or null when no pillar could be scored. */
  overall: number | null;
  pillars: PillarScore[];
  /** Readings that fed no pillar, with the reason. */
  unscored: Contribution[];
  /** Placeholder rules, or any placeholder range underneath. */
  provisional: boolean;
  advisory: true;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function score(inputs: readonly ScoringInput[]): ScoreResult {
  // Stable order, so the stored explanation is identical on recompute.
  const ordered = [...inputs].sort(
    (a, b) => a.markerCode.localeCompare(b.markerCode) || a.readingId.localeCompare(b.readingId),
  );

  const byPillar = new Map<RroPillar, Contribution[]>(RRO_PILLARS.map((p) => [p, []]));
  const unscored: Contribution[] = [];
  let anyPlaceholderRange = false;

  for (const input of ordered) {
    const { status } = input;
    const base = {
      reading_id: input.readingId,
      marker_code: input.markerCode,
      value: input.value,
      status,
      range_id: input.rangeId,
    };

    if (status === 'no_reference' || status === 'unit_mismatch') {
      unscored.push({ ...base, points: null, excluded_reason: status });
      continue;
    }
    if (!input.pillar) {
      unscored.push({ ...base, points: null, excluded_reason: 'no_pillar' });
      continue;
    }
    if (input.provisional) anyPlaceholderRange = true;
    byPillar.get(input.pillar)?.push({
      ...base,
      points: VERDICT_POINTS[status],
      excluded_reason: null,
    });
  }

  const pillars: PillarScore[] = RRO_PILLARS.map((pillar) => {
    const contributions = byPillar.get(pillar) ?? [];
    const scored = contributions.filter((c) => c.points !== null);
    const total = scored.reduce((sum, c) => sum + (c.points ?? 0), 0);
    return {
      pillar,
      score: scored.length === 0 ? null : round1(total / scored.length),
      scored_markers: scored.length,
      contributions,
    };
  });

  // A pillar with no data is left out of the overall rather than counted as
  // zero: missing labs are not bad labs.
  const weighted = pillars.filter((p) => p.score !== null);
  const weightSum = weighted.reduce((sum, p) => sum + PILLAR_WEIGHTS[p.pillar], 0);
  const overall =
    weightSum === 0
      ? null
      : round1(
          weighted.reduce((sum, p) => sum + (p.score as number) * PILLAR_WEIGHTS[p.pillar], 0) /
            weightSum,
        );

  return {
    scoring_version: SCORING_VERSION,
    overall,
    pillars,
    unscored,
    provisional: SCORING_IS_PLACEHOLDER || anyPlaceholderRange,
    advisory: true,
  };
}
