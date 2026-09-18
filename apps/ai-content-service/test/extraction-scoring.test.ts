/**
 * The extraction scorer (P-W8-1) — right before any number it produces means anything.
 *
 *   bun test apps/ai-content-service/test/extraction-scoring.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { readingExtractionOutputSchema } from '@longeny/validators';
import { EXTRACTION_FIXTURES } from '../eval/extraction/fixtures.js';
import { scoreExtraction, summariseExtraction } from '../eval/extraction/score.js';
import { EXTRACTION_MARKERS } from '../src/services/rro/extraction-prompt.js';

const reading = (p: Partial<Record<string, unknown>>) => ({
  markerCode: 'hba1c',
  printedName: 'HbA1c',
  value: 6.1,
  unit: '%',
  measuredAt: null,
  uncertain: false,
  uncertainReason: null,
  ...p,
});
const out = (readings: unknown[], unmapped: string[] = [], unreadable: string[] = []) =>
  readingExtractionOutputSchema.parse({ contract: 'extract-v1', readings, unmapped, unreadable });

const want = [{ markerCode: 'hba1c', printedName: 'HbA1c', value: 6.1, unit: '%' }];

describe('extraction scoring', () => {
  test('an exact read is correct', () => {
    expect(scoreExtraction(want, out([reading({})])).perReading[0]?.verdict).toBe('correct');
  });
  test('the reference interval read as the value is wrong_value', () => {
    expect(scoreExtraction(want, out([reading({ value: 5.6 })])).perReading[0]?.verdict).toBe(
      'wrong_value',
    );
  });
  test('a converted unit is wrong_unit', () => {
    expect(
      scoreExtraction(want, out([reading({ value: 6.1, unit: 'mmol/mol' })])).perReading[0]
        ?.verdict,
    ).toBe('wrong_unit');
  });
  test('a value left out silently is missed; left out and said is missed_but_declared', () => {
    expect(scoreExtraction(want, out([])).perReading[0]?.verdict).toBe('missed');
    expect(scoreExtraction(want, out([], [], ['HbA1c line smudged'])).perReading[0]?.verdict).toBe(
      'missed_but_declared',
    );
  });
  test('a value that must be uncertain and is not is counted', () => {
    const s = scoreExtraction(
      [{ ...want[0], mustBeUncertain: true } as any],
      out([reading({ uncertain: false })]),
    );
    expect(s.perReading[0]?.uncertaintyOk).toBe(false);
  });
  test('extra values are counted', () => {
    expect(scoreExtraction(want, out([reading({}), reading({ printedName: 'Ref' })])).extra).toBe(
      1,
    );
  });
  test('miss rate is separate from accuracy', () => {
    const s = summariseExtraction([scoreExtraction(want, out([]))]);
    expect(s.accuracy.of).toBe(0);
    expect(s.missRate.silent).toBe(1);
  });
});

describe('the eval set itself', () => {
  test('at least three layouts', () =>
    expect(EXTRACTION_FIXTURES.length).toBeGreaterThanOrEqual(3));
  test('every expected code is one the prompt allows', () => {
    for (const f of EXTRACTION_FIXTURES) {
      for (const e of f.expected) {
        if (e.markerCode !== null) expect(Object.keys(EXTRACTION_MARKERS)).toContain(e.markerCode);
      }
    }
  });
  test('a perfect extraction of every fixture scores perfectly', () => {
    const scores = EXTRACTION_FIXTURES.map((f) =>
      scoreExtraction(
        f.expected,
        out(
          f.expected.map((e) =>
            reading({
              ...e,
              uncertain: Boolean(e.mustBeUncertain),
              uncertainReason: e.mustBeUncertain ? 'smudged' : null,
            }),
          ),
        ),
      ),
    );
    const s = summariseExtraction(scores);
    expect(s.accuracy.hit).toBe(s.expected);
    expect(s.missRate.silent).toBe(0);
    expect(s.uncertaintyMissed).toBe(0);
  });
});
