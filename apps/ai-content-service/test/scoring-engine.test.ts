/**
 * Scoring rules (V-W8-5, V-W8-6). Pure function — no services, no database.
 *
 *   bun test apps/ai-content-service/test/scoring-engine.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { SCORING_VERSION, type ScoringInput, score } from '../src/services/benchmark/scoring.js';

let n = 0;
const input = (overrides: Partial<ScoringInput>): ScoringInput => ({
  readingId: `r${String(++n).padStart(3, '0')}`,
  markerCode: `m${n}`,
  value: 1,
  status: 'normal',
  rangeId: `range${n}`,
  provisional: false,
  pillar: 'nutrition',
  ...overrides,
});

describe('pillar scores', () => {
  test('a pillar is the average of its markers’ points', () => {
    const result = score([
      input({ status: 'optimal', pillar: 'nutrition' }),
      input({ status: 'normal', pillar: 'nutrition' }),
    ]);
    const nutrition = result.pillars.find((p) => p.pillar === 'nutrition');
    expect(nutrition?.score).toBe(85);
    expect(nutrition?.scored_markers).toBe(2);
  });

  test('low and high score the same — out of range either way', () => {
    const low = score([input({ status: 'low' })]).pillars.find((p) => p.pillar === 'nutrition');
    const high = score([input({ status: 'high' })]).pillars.find((p) => p.pillar === 'nutrition');
    expect(low?.score).toBe(high?.score as number);
  });

  test('a pillar with no readings is null, not zero', () => {
    const result = score([input({ pillar: 'nutrition' })]);
    expect(result.pillars.find((p) => p.pillar === 'sleep')?.score).toBeNull();
  });

  test('every pillar is always listed', () => {
    expect(score([]).pillars.map((p) => p.pillar)).toEqual([
      'nutrition',
      'movement',
      'sleep',
      'stress',
      'environment',
    ]);
  });
});

describe('what is not scored', () => {
  test('no_reference and unit_mismatch are listed with the reason, not scored', () => {
    const result = score([
      input({ status: 'no_reference', rangeId: null, pillar: null }),
      input({ status: 'unit_mismatch' }),
    ]);
    expect(result.unscored.map((u) => u.excluded_reason).sort()).toEqual([
      'no_reference',
      'unit_mismatch',
    ]);
    expect(result.overall).toBeNull();
  });

  test('a marker whose range has no pillar is listed as no_pillar', () => {
    const result = score([input({ pillar: null })]);
    expect(result.unscored[0]?.excluded_reason).toBe('no_pillar');
  });
});

describe('overall', () => {
  test('averages the pillars that have data, leaving out the ones that do not', () => {
    const result = score([
      input({ status: 'optimal', pillar: 'nutrition' }),
      input({ status: 'low', pillar: 'sleep' }),
    ]);
    // (100 + 30) / 2 — the three empty pillars do not drag it towards zero.
    expect(result.overall).toBe(65);
  });

  test('null when nothing could be scored', () => {
    expect(score([]).overall).toBeNull();
  });

  test('rounded to one decimal place', () => {
    const result = score([
      input({ status: 'optimal', pillar: 'nutrition' }),
      input({ status: 'normal', pillar: 'nutrition' }),
      input({ status: 'normal', pillar: 'nutrition' }),
    ]);
    expect(result.overall).toBe(80);
    const odd = score([
      input({ status: 'optimal', pillar: 'nutrition' }),
      input({ status: 'low', pillar: 'nutrition' }),
      input({ status: 'low', pillar: 'nutrition' }),
    ]);
    expect(odd.overall).toBe(53.3);
  });
});

describe('versioned, explainable, advisory', () => {
  test('names the rule set it used', () => {
    expect(score([]).scoring_version).toBe(SCORING_VERSION);
  });

  test('is always advisory', () => {
    expect(score([input({})]).advisory).toBe(true);
  });

  test('is provisional while the rules are placeholders', () => {
    expect(score([input({ provisional: false })]).provisional).toBe(true);
  });

  test('every scored reading is in the explanation with its points', () => {
    const a = input({ status: 'optimal' });
    const result = score([a]);
    const c = result.pillars[0]?.contributions[0];
    expect(c?.reading_id).toBe(a.readingId);
    expect(c?.points).toBe(100);
    expect(c?.range_id).toBe(a.rangeId);
  });

  test('the same inputs in any order give the identical result', () => {
    const inputs = [
      input({ status: 'optimal', pillar: 'sleep' }),
      input({ status: 'high', pillar: 'nutrition' }),
      input({ status: 'no_reference', pillar: null, rangeId: null }),
    ];
    const first = JSON.stringify(score(inputs));
    expect(JSON.stringify(score([...inputs].reverse()))).toBe(first);
    expect(JSON.stringify(score(inputs))).toBe(first);
  });
});
