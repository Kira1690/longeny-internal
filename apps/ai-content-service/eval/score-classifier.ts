import type { RroClassifierOutput, RroRefusal, RroSummaryOutput } from '@longeny/validators';
import type { ClassifierFixture, SummaryFixture } from './classifier-fixtures.js';

/**
 * Scoring for the classifier and summary evals. Pure: a fixture and an output
 * in, a verdict out. The runner does the calling.
 */

export type ClassifierOutcome =
  | { kind: 'output'; value: RroClassifierOutput | RroRefusal }
  | { kind: 'invalid'; error: string };

export interface CaseResult {
  id: string;
  strict: boolean;
  lenient: boolean;
  refusalCorrect: boolean | null;
  topPillar: boolean | null;
  topThree: boolean | null;
  got: string;
  expected: string;
}

export function scoreClassifierCase(f: ClassifierFixture, o: ClassifierOutcome): CaseResult {
  const expected = 'refusal' in f.expect ? 'refusal' : f.expect.state;
  if (o.kind === 'invalid') {
    return {
      id: f.id,
      strict: false,
      lenient: false,
      refusalCorrect: 'refusal' in f.expect ? false : null,
      topPillar: null,
      topThree: null,
      got: `INVALID: ${o.error}`,
      expected,
    };
  }

  const refused = 'refused' in o.value;
  if ('refusal' in f.expect) {
    return {
      id: f.id,
      strict: refused,
      lenient: refused,
      refusalCorrect: refused,
      topPillar: null,
      topThree: null,
      got: refused ? 'refusal' : (o.value as RroClassifierOutput).state,
      expected,
    };
  }

  if (refused) {
    return {
      id: f.id,
      strict: false,
      lenient: false,
      refusalCorrect: false,
      topPillar: f.expect.topPillar ? false : null,
      topThree: f.expect.inTopThree ? false : null,
      got: 'refusal',
      expected,
    };
  }

  const out = o.value as RroClassifierOutput;
  const strict = out.state === f.expect.state;
  const lenient = strict || (f.expect.acceptable ?? []).includes(out.state);
  const top3 = out.pillarPriorities.slice(0, 3);
  return {
    id: f.id,
    strict,
    lenient,
    refusalCorrect: null,
    topPillar: f.expect.topPillar ? out.pillarPriorities[0] === f.expect.topPillar : null,
    topThree: f.expect.inTopThree ? f.expect.inTopThree.every((p) => top3.includes(p)) : null,
    got: `${out.state} [${out.pillarPriorities.slice(0, 3).join(',')}]`,
    expected,
  };
}

const rate = (xs: (boolean | null)[]) => {
  const scored = xs.filter((x): x is boolean => x !== null);
  return { hit: scored.filter(Boolean).length, of: scored.length };
};

export function summariseClassifier(results: CaseResult[]) {
  return {
    cases: results.length,
    strictState: rate(results.map((r) => r.strict)),
    lenientState: rate(results.map((r) => r.lenient)),
    refusals: rate(results.map((r) => r.refusalCorrect)),
    topPillar: rate(results.map((r) => r.topPillar)),
    topThree: rate(results.map((r) => r.topThree)),
    invalid: results.filter((r) => r.got.startsWith('INVALID')).length,
  };
}

export interface SummaryCaseResult {
  id: string;
  sufficientCorrect: boolean;
  /** Expected flags found with the right severity. */
  flagsFound: number;
  flagsExpected: number;
  /** Flags raised that the fixture did not expect — invented findings. */
  unexpectedFlags: number;
  detail: string;
}

export function scoreSummaryCase(
  f: SummaryFixture,
  o: RroSummaryOutput | RroRefusal | { invalid: string },
): SummaryCaseResult {
  if ('invalid' in o || 'refused' in o) {
    const refusedOk = 'refused' in o && !f.expect.sufficientData;
    return {
      id: f.id,
      sufficientCorrect: refusedOk,
      flagsFound: 0,
      flagsExpected: f.expect.redFlags.length,
      unexpectedFlags: 0,
      detail: 'invalid' in o ? `INVALID: ${o.invalid}` : 'refusal',
    };
  }
  const found = f.expect.redFlags.filter((want) =>
    o.redFlags.some(
      (got) =>
        got.severity === want.severity &&
        `${got.finding} ${got.basis}`.toLowerCase().includes(want.contains.toLowerCase()),
    ),
  ).length;
  const unexpected =
    f.expect.redFlags.length === 0 ? o.redFlags.length : Math.max(0, o.redFlags.length - found);
  return {
    id: f.id,
    sufficientCorrect: o.sufficientData === f.expect.sufficientData,
    flagsFound: found,
    flagsExpected: f.expect.redFlags.length,
    unexpectedFlags: f.expect.redFlags.length === 0 ? unexpected : 0,
    detail: o.redFlags.map((r) => `${r.severity}:${r.finding}`).join('; ') || '(no flags)',
  };
}
