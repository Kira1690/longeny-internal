/**
 * Trend rules (V-W8-4). Pure function — no services, no database.
 *
 *   bun test apps/ai-content-service/test/trend-engine.test.ts
 */
import { describe, expect, test } from 'bun:test';
import type { RangeInput } from '../src/services/benchmark/engine.js';
import {
  type TrendPoint,
  computeTrend,
  distanceFromBand,
} from '../src/services/benchmark/trend.js';

const range = (overrides: Partial<RangeInput> = {}): RangeInput => ({
  id: 'r',
  markerCode: 'hba1c',
  markerName: 'HbA1c',
  unit: '%',
  sex: 'any',
  ageMinYears: null,
  ageMaxYears: null,
  normalLow: 4,
  normalHigh: 5.6,
  optimalLow: 4.5,
  optimalHigh: 5.2,
  source: 'test',
  isPlaceholder: true,
  effectiveFrom: new Date('2026-01-01'),
  ...overrides,
});

let n = 0;
const point = (value: number, day: number, unit = '%'): TrendPoint => ({
  readingId: `p${++n}`,
  value,
  unit,
  measuredAt: new Date(Date.UTC(2026, 0, day)),
});

describe('distanceFromBand', () => {
  const r = range();
  test('inside the optimal band is zero', () => expect(distanceFromBand(5, r)).toBe(0));
  test('above it is the gap to the top', () => expect(distanceFromBand(6, r)).toBeCloseTo(0.8));
  test('below it is the gap to the bottom', () => expect(distanceFromBand(4, r)).toBeCloseTo(0.5));
  test('with no optimal band, the normal band is the target', () => {
    const plain = range({ optimalLow: null, optimalHigh: null });
    expect(distanceFromBand(5.4, plain)).toBe(0);
    expect(distanceFromBand(6, plain)).toBeCloseTo(0.4);
  });
});

describe('computeTrend', () => {
  test('one point has no direction', () => {
    const t = computeTrend([point(5.4, 1)], range());
    expect(t.direction).toBeNull();
    expect(t.towardRange).toBeNull();
    expect(t.points).toHaveLength(1);
  });

  test('no points is empty, not an error', () => {
    const t = computeTrend([], range());
    expect(t.points).toHaveLength(0);
    expect(t.direction).toBeNull();
  });

  test('HbA1c falling from high towards the band is improving', () => {
    const t = computeTrend([point(6.2, 1), point(5.8, 60)], range());
    expect(t.direction).toBe('falling');
    expect(t.towardRange).toBe('improving');
    expect(t.change).toBe(-0.4);
  });

  test('rising further out of the band is worsening', () => {
    const t = computeTrend([point(5.8, 1), point(6.2, 60)], range());
    expect(t.direction).toBe('rising');
    expect(t.towardRange).toBe('worsening');
  });

  test('HDL rising towards a floor-only band is improving — rising is not always bad', () => {
    const hdl = range({
      normalLow: 40,
      normalHigh: null,
      optimalLow: 60,
      optimalHigh: null,
      unit: 'mg/dL',
    });
    const t = computeTrend([point(42, 1, 'mg/dL'), point(55, 60, 'mg/dL')], hdl);
    expect(t.direction).toBe('rising');
    expect(t.towardRange).toBe('improving');
  });

  test('moving within the band is unchanged, not improving', () => {
    const t = computeTrend([point(4.8, 1), point(5.1, 60)], range());
    expect(t.direction).toBe('rising');
    expect(t.towardRange).toBe('unchanged');
  });

  test('order is by sample date, not the order given', () => {
    const t = computeTrend([point(5.8, 60), point(6.2, 1)], range());
    expect(t.direction).toBe('falling');
    expect(t.points.map((p) => p.value)).toEqual([6.2, 5.8]);
  });

  test('no range → direction but no judgement', () => {
    const t = computeTrend([point(6.2, 1), point(5.8, 60)], null);
    expect(t.direction).toBe('falling');
    expect(t.towardRange).toBeNull();
    expect(t.provisional).toBe(false);
  });

  test('a range in another unit gives no judgement', () => {
    const t = computeTrend([point(6.2, 1), point(5.8, 60)], range({ unit: 'mmol/mol' }));
    expect(t.towardRange).toBeNull();
  });

  test('points in another unit are left out and counted, never converted', () => {
    const t = computeTrend([point(44, 1, 'mmol/mol'), point(6.2, 30), point(5.8, 60)], range());
    expect(t.points).toHaveLength(2);
    expect(t.excludedForUnit).toBe(1);
    expect(t.direction).toBe('falling');
  });

  test('the newest reading decides the series unit', () => {
    const t = computeTrend([point(6.2, 1), point(44, 60, 'mmol/mol')], range());
    expect(t.points).toHaveLength(1);
    expect(t.points[0]?.unit).toBe('mmol/mol');
    expect(t.direction).toBeNull();
  });

  test('equal values are flat', () => {
    expect(computeTrend([point(5, 1), point(5, 2)], range()).direction).toBe('flat');
  });

  test('percent change is relative to the earlier value, and null from zero', () => {
    expect(computeTrend([point(4, 1), point(5, 2)], null).changePercent).toBe(25);
    expect(computeTrend([point(0, 1), point(5, 2)], null).changePercent).toBeNull();
  });

  test('a placeholder range makes the judgement provisional', () => {
    expect(computeTrend([point(6.2, 1), point(5.8, 2)], range()).provisional).toBe(true);
    expect(
      computeTrend([point(6.2, 1), point(5.8, 2)], range({ isPlaceholder: false })).provisional,
    ).toBe(false);
  });
});
