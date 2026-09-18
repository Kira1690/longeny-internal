import type { BenchmarkStatus, NoReferenceReason, RangeSex } from '@longeny/types';

/**
 * The benchmark engine — one reading, judged against one reference range.
 *
 * Pure: no database, no clock, no I/O. The service reads the rows and this
 * decides, so the rules can be tested exhaustively and a benchmark can be
 * recomputed from stored inputs and give the identical answer.
 *
 * Three things it refuses to do, each of which would turn a missing input into
 * a confident-looking wrong answer:
 *
 *  - guess a range when none applies (`no_reference`)
 *  - convert units (`unit_mismatch`) — mg/dL and mmol/L differ by a
 *    marker-specific factor, and a wrong factor is silent
 *  - apply a sex- or age-specific range to someone whose sex or age is unknown
 */

export interface RangeInput {
  id: string;
  markerCode: string;
  markerName: string;
  unit: string;
  sex: RangeSex;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  normalLow: number | null;
  normalHigh: number | null;
  optimalLow: number | null;
  optimalHigh: number | null;
  source: string;
  isPlaceholder: boolean;
  effectiveFrom: Date;
}

export interface ReadingInput {
  markerCode: string;
  value: number;
  unit: string;
}

/** What is known about the person. Both are optional and often absent. */
export interface Subject {
  sex?: 'male' | 'female';
  ageYears?: number;
}

export interface BenchmarkVerdict {
  status: BenchmarkStatus;
  /** Set only when `status` is `no_reference`. */
  reason?: NoReferenceReason;
  /** The range the verdict was reached against; null when there was none. */
  range: RangeInput | null;
  /** True whenever the range is a placeholder — the verdict is not clinical. */
  provisional: boolean;
}

/** Units compare as written, ignoring case and surrounding space only. */
export function sameUnit(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function appliesTo(range: RangeInput, subject: Subject): boolean {
  if (range.sex !== 'any' && range.sex !== subject.sex) return false;
  const ageBounded = range.ageMinYears !== null || range.ageMaxYears !== null;
  if (!ageBounded) return true;
  if (subject.ageYears === undefined) return false;
  if (range.ageMinYears !== null && subject.ageYears < range.ageMinYears) return false;
  if (range.ageMaxYears !== null && subject.ageYears > range.ageMaxYears) return false;
  return true;
}

/** Higher is more specific. A range written for this person beats a general one. */
function specificity(range: RangeInput): number {
  const bySex = range.sex === 'any' ? 0 : 2;
  const byAge = range.ageMinYears === null && range.ageMaxYears === null ? 0 : 1;
  return bySex + byAge;
}

/**
 * The range that applies to this subject for this marker, or why there is none.
 *
 * Most specific wins; among equally specific ranges the most recently effective
 * wins, so a revised range replaces the one it revises without a delete.
 */
export function selectRange(
  markerCode: string,
  ranges: readonly RangeInput[],
  subject: Subject,
): { range: RangeInput } | { reason: NoReferenceReason } {
  const forMarker = ranges.filter((r) => r.markerCode === markerCode);
  if (forMarker.length === 0) return { reason: 'no_range_for_marker' };

  const applicable = forMarker.filter((r) => appliesTo(r, subject));
  if (applicable.length === 0) return { reason: 'needs_demographics' };

  const [best] = [...applicable].sort(
    (a, b) =>
      specificity(b) - specificity(a) || b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
  );
  return { range: best as RangeInput };
}

/**
 * Where a value sits in a range. Bounds are inclusive: a value on the line is
 * inside it, which is how printed lab ranges are read.
 */
export function classify(value: number, range: RangeInput): BenchmarkStatus {
  if (range.normalLow !== null && value < range.normalLow) return 'low';
  if (range.normalHigh !== null && value > range.normalHigh) return 'high';

  const hasOptimal = range.optimalLow !== null || range.optimalHigh !== null;
  if (!hasOptimal) return 'normal';

  const aboveOptimalFloor = range.optimalLow === null || value >= range.optimalLow;
  const belowOptimalCeiling = range.optimalHigh === null || value <= range.optimalHigh;
  return aboveOptimalFloor && belowOptimalCeiling ? 'optimal' : 'normal';
}

export function benchmark(
  reading: ReadingInput,
  ranges: readonly RangeInput[],
  subject: Subject = {},
): BenchmarkVerdict {
  const selected = selectRange(reading.markerCode, ranges, subject);
  if ('reason' in selected) {
    return { status: 'no_reference', reason: selected.reason, range: null, provisional: false };
  }

  const { range } = selected;
  const provisional = range.isPlaceholder;

  if (!sameUnit(reading.unit, range.unit)) {
    return { status: 'unit_mismatch', range, provisional };
  }

  return { status: classify(reading.value, range), range, provisional };
}
