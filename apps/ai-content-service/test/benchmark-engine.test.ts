/**
 * The benchmark engine's rules, exhaustively. Pure function — no services, no
 * database. The same rules are exercised through the API in benchmarks.e2e.ts.
 *
 *   bun test apps/ai-content-service/test/benchmark-engine.test.ts
 */
import { describe, expect, test } from 'bun:test';
import {
  type RangeInput,
  benchmark,
  classify,
  selectRange,
} from '../src/services/benchmark/engine.js';

let seq = 0;
function range(overrides: Partial<RangeInput> = {}): RangeInput {
  seq++;
  return {
    id: `range-${seq}`,
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
  };
}

describe('classify — where a value sits', () => {
  const r = range();

  test('below the normal band is low', () => expect(classify(3.9, r)).toBe('low'));
  test('above the normal band is high', () => expect(classify(5.7, r)).toBe('high'));
  test('inside optimal is optimal', () => expect(classify(5.0, r)).toBe('optimal'));
  test('normal but not optimal is normal', () => expect(classify(5.4, r)).toBe('normal'));
  test('bounds are inclusive — on the normal line is not out of range', () => {
    expect(classify(4, r)).toBe('normal');
    expect(classify(5.6, r)).toBe('normal');
  });
  test('bounds are inclusive — on the optimal line is optimal', () => {
    expect(classify(4.5, r)).toBe('optimal');
    expect(classify(5.2, r)).toBe('optimal');
  });
  test('no optimal band means inside normal is just normal', () => {
    expect(classify(5, range({ optimalLow: null, optimalHigh: null }))).toBe('normal');
  });
  test('an upper-limit-only range (LDL) has no low', () => {
    const ldl = range({ normalLow: null, normalHigh: 130, optimalLow: null, optimalHigh: 100 });
    expect(classify(0, ldl)).toBe('optimal');
    expect(classify(120, ldl)).toBe('normal');
    expect(classify(131, ldl)).toBe('high');
  });
  test('a lower-limit-only range (vitamin D) has no high', () => {
    const vitD = range({ normalLow: 20, normalHigh: null, optimalLow: 30, optimalHigh: null });
    expect(classify(19, vitD)).toBe('low');
    expect(classify(25, vitD)).toBe('normal');
    expect(classify(900, vitD)).toBe('optimal');
  });
});

describe('selectRange — which range applies', () => {
  test('no range for the marker at all', () => {
    expect(selectRange('ldl_c', [range()], {})).toEqual({ reason: 'no_range_for_marker' });
  });

  test('a sex-specific range is never applied to someone whose sex is unknown', () => {
    const male = range({ sex: 'male' });
    expect(selectRange('hba1c', [male], {})).toEqual({ reason: 'needs_demographics' });
  });

  test('nor to someone of the other sex', () => {
    const male = range({ sex: 'male' });
    expect(selectRange('hba1c', [male], { sex: 'female' })).toEqual({
      reason: 'needs_demographics',
    });
  });

  test('an age-banded range is never applied when age is unknown', () => {
    const adults = range({ ageMinYears: 18, ageMaxYears: 64 });
    expect(selectRange('hba1c', [adults], {})).toEqual({ reason: 'needs_demographics' });
  });

  test('age bounds are inclusive at both ends', () => {
    const adults = range({ ageMinYears: 18, ageMaxYears: 64 });
    expect(selectRange('hba1c', [adults], { ageYears: 18 })).toEqual({ range: adults });
    expect(selectRange('hba1c', [adults], { ageYears: 64 })).toEqual({ range: adults });
    expect(selectRange('hba1c', [adults], { ageYears: 65 })).toEqual({
      reason: 'needs_demographics',
    });
  });

  test('the general range is used when demographics are unknown', () => {
    const general = range();
    const male = range({ sex: 'male' });
    expect(selectRange('hba1c', [male, general], {})).toEqual({ range: general });
  });

  test('the more specific range wins when it applies', () => {
    const general = range();
    const male = range({ sex: 'male' });
    const maleAdult = range({ sex: 'male', ageMinYears: 18, ageMaxYears: 64 });
    expect(selectRange('hba1c', [general, male, maleAdult], { sex: 'male', ageYears: 40 })).toEqual(
      { range: maleAdult },
    );
    expect(selectRange('hba1c', [general, male, maleAdult], { sex: 'male', ageYears: 70 })).toEqual(
      { range: male },
    );
  });

  test('sex outranks age when both kinds of specific range apply', () => {
    const male = range({ sex: 'male' });
    const adults = range({ ageMinYears: 18, ageMaxYears: 64 });
    expect(selectRange('hba1c', [adults, male], { sex: 'male', ageYears: 40 })).toEqual({
      range: male,
    });
  });

  test('among equally specific ranges, the most recently effective wins', () => {
    const old = range({ effectiveFrom: new Date('2025-01-01') });
    const revised = range({ effectiveFrom: new Date('2026-06-01') });
    expect(selectRange('hba1c', [old, revised], {})).toEqual({ range: revised });
    expect(selectRange('hba1c', [revised, old], {})).toEqual({ range: revised });
  });
});

describe('benchmark — the verdict', () => {
  test('a placeholder range makes the verdict provisional', () => {
    const v = benchmark({ markerCode: 'hba1c', value: 5.0, unit: '%' }, [range()]);
    expect(v.status).toBe('optimal');
    expect(v.provisional).toBe(true);
  });

  test('a reviewed range does not', () => {
    const v = benchmark({ markerCode: 'hba1c', value: 5.0, unit: '%' }, [
      range({ isPlaceholder: false }),
    ]);
    expect(v.provisional).toBe(false);
  });

  test('a unit mismatch is reported, never converted', () => {
    const v = benchmark({ markerCode: 'hba1c', value: 36, unit: 'mmol/mol' }, [range()]);
    expect(v.status).toBe('unit_mismatch');
    expect(v.range).not.toBeNull();
  });

  test('units compare ignoring case and surrounding space only', () => {
    const r = range({ unit: 'mg/dL' });
    const v = benchmark({ markerCode: 'hba1c', value: 5, unit: ' MG/DL ' }, [r]);
    expect(v.status).not.toBe('unit_mismatch');
  });

  test('no range → no_reference, no range, not provisional', () => {
    const v = benchmark({ markerCode: 'ldl_c', value: 90, unit: 'mg/dL' }, [range()]);
    expect(v).toEqual({
      status: 'no_reference',
      reason: 'no_range_for_marker',
      range: null,
      provisional: false,
    });
  });

  test('the same inputs always give the same verdict', () => {
    const ranges = [range(), range({ sex: 'female' })];
    const reading = { markerCode: 'hba1c', value: 5.4, unit: '%' };
    const first = benchmark(reading, ranges, { sex: 'female' });
    for (let i = 0; i < 5; i++) {
      expect(benchmark(reading, ranges, { sex: 'female' })).toEqual(first);
    }
  });
});
