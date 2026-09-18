import { type RangeInput, sameUnit } from './engine.js';

/**
 * Direction of travel for one marker (Week 8, V-W8-4).
 *
 * Pure, like the benchmark engine. Two separate answers, because they mean
 * different things:
 *
 *  - `direction` — did the number go up or down. Arithmetic, always available
 *    with two comparable points.
 *  - `toward_range` — is the value moving towards the band it should be in.
 *    Rising HbA1c is bad and rising HDL is good; only the range knows which, so
 *    without a usable range this is null rather than guessed.
 *
 * Points in different units are never compared. The series is cut to the unit
 * of the newest reading and the rest are counted, not converted.
 */

export interface TrendPoint {
  readingId: string;
  value: number;
  unit: string;
  measuredAt: Date;
}

export type Direction = 'rising' | 'falling' | 'flat';
export type TowardRange = 'improving' | 'worsening' | 'unchanged';

export interface Trend {
  points: TrendPoint[];
  /** Points left out because their unit differs from the newest reading's. */
  excludedForUnit: number;
  direction: Direction | null;
  /** Latest minus the one before it, in the series unit. */
  change: number | null;
  /** Relative to the earlier value; null when that value is zero. */
  changePercent: number | null;
  towardRange: TowardRange | null;
  /** True when `towardRange` was judged against a placeholder range. */
  provisional: boolean;
}

/** How far a value sits outside the target band; zero inside it. */
export function distanceFromBand(value: number, range: RangeInput): number {
  const hasOptimal = range.optimalLow !== null || range.optimalHigh !== null;
  const low = hasOptimal ? range.optimalLow : range.normalLow;
  const high = hasOptimal ? range.optimalHigh : range.normalHigh;
  if (low !== null && value < low) return low - value;
  if (high !== null && value > high) return value - high;
  return 0;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function computeTrend(points: readonly TrendPoint[], range: RangeInput | null): Trend {
  const ordered = [...points].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const newest = ordered[ordered.length - 1];

  const comparable = newest ? ordered.filter((p) => sameUnit(p.unit, newest.unit)) : [];
  const excludedForUnit = ordered.length - comparable.length;

  const base: Trend = {
    points: comparable,
    excludedForUnit,
    direction: null,
    change: null,
    changePercent: null,
    towardRange: null,
    provisional: false,
  };
  if (comparable.length < 2) return base;

  const latest = comparable[comparable.length - 1] as TrendPoint;
  const previous = comparable[comparable.length - 2] as TrendPoint;
  const change = round4(latest.value - previous.value);
  const direction: Direction = change > 0 ? 'rising' : change < 0 ? 'falling' : 'flat';
  const changePercent =
    previous.value === 0 ? null : round4((change / Math.abs(previous.value)) * 100);

  let towardRange: TowardRange | null = null;
  let provisional = false;
  if (range && sameUnit(range.unit, latest.unit)) {
    const before = distanceFromBand(previous.value, range);
    const after = distanceFromBand(latest.value, range);
    towardRange = after < before ? 'improving' : after > before ? 'worsening' : 'unchanged';
    provisional = range.isPlaceholder;
  }

  return { ...base, direction, change, changePercent, towardRange, provisional };
}
