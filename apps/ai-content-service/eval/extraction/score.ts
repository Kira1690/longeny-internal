import type { ReadingExtractionOutput } from '@longeny/validators';
import type { ExpectedReading } from './fixtures.js';

/**
 * Extraction scoring. **Miss rate is reported separately from accuracy**: a
 * value silently skipped is worse than one read wrongly, because nobody goes
 * looking for it.
 *
 * A value is matched to an expectation by printed name (case- and
 * space-insensitive), so a wrong code does not hide a correct read.
 */

export type ReadingVerdict =
  | 'correct'
  | 'wrong_value'
  | 'wrong_unit'
  | 'wrong_code'
  | 'missed'
  | 'missed_but_declared';

export interface ExtractionCaseScore {
  perReading: { printedName: string; verdict: ReadingVerdict; uncertaintyOk: boolean }[];
  /** Values returned that no expectation matches — possibly a reference interval read as a value. */
  extra: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function scoreExtraction(
  expected: ExpectedReading[],
  got: ReadingExtractionOutput,
): ExtractionCaseScore {
  const used = new Set<number>();
  const declared = new Set([...got.unmapped, ...got.unreadable].map(norm));

  const perReading = expected.map((want) => {
    const idx = got.readings.findIndex(
      (r, i) => !used.has(i) && norm(r.printedName) === norm(want.printedName),
    );
    if (idx === -1) {
      const saidSo = [...declared].some((d) => d.includes(norm(want.printedName)));
      return {
        printedName: want.printedName,
        verdict: (saidSo ? 'missed_but_declared' : 'missed') as ReadingVerdict,
        uncertaintyOk: !want.mustBeUncertain,
      };
    }
    used.add(idx);
    const r = got.readings[idx];
    if (!r) throw new Error('unreachable');
    let verdict: ReadingVerdict = 'correct';
    if (r.value !== want.value) verdict = 'wrong_value';
    else if (norm(r.unit) !== norm(want.unit)) verdict = 'wrong_unit';
    else if (r.markerCode !== want.markerCode) verdict = 'wrong_code';
    return {
      printedName: want.printedName,
      verdict,
      uncertaintyOk: want.mustBeUncertain ? r.uncertain : true,
    };
  });

  return { perReading, extra: got.readings.length - used.size };
}

export function summariseExtraction(scores: ExtractionCaseScore[]) {
  const all = scores.flatMap((s) => s.perReading);
  const count = (v: ReadingVerdict) => all.filter((r) => r.verdict === v).length;
  const found = all.length - count('missed') - count('missed_but_declared');
  return {
    expected: all.length,
    accuracy: { hit: count('correct'), of: found },
    missRate: { silent: count('missed'), declared: count('missed_but_declared'), of: all.length },
    wrongValue: count('wrong_value'),
    wrongUnit: count('wrong_unit'),
    wrongCode: count('wrong_code'),
    uncertaintyMissed: all.filter((r) => !r.uncertaintyOk).length,
    extra: scores.reduce((n, s) => n + s.extra, 0),
  };
}
