/**
 * The eval scorers must be right before any number they produce means anything.
 *
 *   bun test apps/ai-content-service/test/eval-scoring.test.ts
 */
import { describe, expect, test } from 'bun:test';
import type { ClassifierFixture, SummaryFixture } from '../eval/classifier-fixtures.js';
import { scoreClassifierCase, scoreSummaryCase } from '../eval/score-classifier.js';

const intake = {
  symptoms: ['x'],
  goals: [],
  conditions: [],
  medications: [],
  pillarPriorities: [],
};
const fixture = (expect: ClassifierFixture['expect']): ClassifierFixture => ({
  id: 't',
  about: 't',
  intake,
  expect,
  review: 'draft',
});
const out = (state: 'intake' | 'reverse' | 'restore' | 'optimise', pillars = ['sleep'] as any) => ({
  kind: 'output' as const,
  value: {
    contractVersion: 'v1' as const,
    state,
    confidence: 0.5,
    pillarPriorities: pillars,
    rationale: 'r',
    missingData: [],
  },
});
const refusal = {
  kind: 'output' as const,
  value: {
    contractVersion: 'v1' as const,
    refused: true as const,
    reason: 'insufficient_data' as const,
    detail: '',
  },
};

describe('classifier scoring', () => {
  test('exact state is strict and lenient', () => {
    const r = scoreClassifierCase(fixture({ state: 'reverse' }), out('reverse'));
    expect([r.strict, r.lenient]).toEqual([true, true]);
  });
  test('an acceptable alternative is lenient only', () => {
    const r = scoreClassifierCase(
      fixture({ state: 'reverse', acceptable: ['restore'] }),
      out('restore'),
    );
    expect([r.strict, r.lenient]).toEqual([false, true]);
  });
  test('a refusal where a state was expected is wrong, and wrong about refusing', () => {
    const r = scoreClassifierCase(fixture({ state: 'reverse' }), refusal);
    expect([r.strict, r.refusalCorrect]).toEqual([false, false]);
  });
  test('an expected refusal is only met by a refusal', () => {
    expect(scoreClassifierCase(fixture({ refusal: true }), refusal).strict).toBe(true);
    expect(scoreClassifierCase(fixture({ refusal: true }), out('optimise')).strict).toBe(false);
  });
  test('top pillar and top three', () => {
    const r = scoreClassifierCase(
      fixture({ state: 'reverse', topPillar: 'sleep', inTopThree: ['sleep', 'stress'] }),
      out('reverse', ['sleep', 'nutrition', 'stress']),
    );
    expect([r.topPillar, r.topThree]).toEqual([true, true]);
  });
  test('a contract-invalid output scores nothing', () => {
    const r = scoreClassifierCase(fixture({ state: 'reverse' }), { kind: 'invalid', error: 'x' });
    expect(r.lenient).toBe(false);
    expect(r.got.startsWith('INVALID')).toBe(true);
  });
});

describe('summary scoring', () => {
  const sf = (redFlags: SummaryFixture['expect']['redFlags']): SummaryFixture => ({
    id: 's',
    about: 's',
    intake,
    expect: { sufficientData: true, redFlags },
    review: 'draft',
  });
  const summary = (flags: { finding: string; severity: 'urgent' | 'emergency' | 'routine' }[]) => ({
    contractVersion: 'v1' as const,
    concerns: [],
    missingData: [],
    redFlags: flags.map((f) => ({ ...f, basis: 'b' })),
    suggestedQuestions: [],
    sufficientData: true,
  });

  test('a flag counts only at the right severity', () => {
    const want = sf([{ contains: 'chest pain', severity: 'emergency' }]);
    expect(
      scoreSummaryCase(want, summary([{ finding: 'chest pain', severity: 'emergency' }]))
        .flagsFound,
    ).toBe(1);
    expect(
      scoreSummaryCase(want, summary([{ finding: 'chest pain', severity: 'urgent' }])).flagsFound,
    ).toBe(0);
  });
  test('a flag raised on a clean intake is counted as invented', () => {
    expect(
      scoreSummaryCase(sf([]), summary([{ finding: 'x', severity: 'urgent' }])).unexpectedFlags,
    ).toBe(1);
  });
});
