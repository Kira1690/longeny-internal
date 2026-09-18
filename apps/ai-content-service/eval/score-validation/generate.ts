/**
 * Build the score-validation sheet (P-W8-2).
 *
 *   bun run apps/ai-content-service/eval/score-validation/generate.ts > score-validation.csv
 *
 * One row per case per pillar that has data, plus one overall row. The engine's
 * score is filled in; `clinician_score` (0–100), `category` and `note` are left
 * for the clinician. Categories: bad_weight, missing_data, wrong_range,
 * ambiguous, agree.
 *
 * No database, no services: the same engine functions the API uses, run over
 * the placeholder ranges.
 */
import { PLACEHOLDER_RANGES, PLACEHOLDER_SOURCE } from '../../src/db/placeholder-ranges.js';
import { type RangeInput, benchmark } from '../../src/services/benchmark/engine.js';
import { SCORING_VERSION, score } from '../../src/services/benchmark/scoring.js';
import { VALIDATION_CASES } from './cases.js';

const ranges: RangeInput[] = PLACEHOLDER_RANGES.map((r) => ({
  id: r.code,
  markerCode: r.code,
  markerName: r.name,
  unit: r.unit,
  sex: 'any',
  ageMinYears: null,
  ageMaxYears: null,
  normalLow: r.nLow,
  normalHigh: r.nHigh,
  optimalLow: r.oLow,
  optimalHigh: r.oHigh,
  source: PLACEHOLDER_SOURCE,
  isPlaceholder: true,
  effectiveFrom: new Date(0),
}));
const pillarOf = new Map(PLACEHOLDER_RANGES.map((r) => [r.code, r.pillar]));

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

console.log(
  ['case', 'about', 'pillar', 'readings', 'engine_score', 'clinician_score', 'category', 'note']
    .map(csv)
    .join(','),
);

export function engineRows() {
  return VALIDATION_CASES.map((c) => {
    const inputs = c.readings.map((r, i) => {
      const verdict = benchmark({ markerCode: r.code, value: r.value, unit: r.unit }, ranges);
      return {
        readingId: `${c.id}-${i}`,
        markerCode: r.code,
        value: r.value,
        status: verdict.status,
        rangeId: verdict.range?.id ?? null,
        provisional: verdict.provisional,
        pillar: verdict.range ? (pillarOf.get(r.code) ?? null) : null,
      };
    });
    return { c, inputs, result: score(inputs) };
  });
}

if (import.meta.main) {
  for (const { c, inputs, result } of engineRows()) {
    for (const p of result.pillars.filter((x) => x.score !== null)) {
      const shown = inputs
        .filter((x) => x.pillar === p.pillar)
        .map((x) => `${x.markerCode}=${x.value} (${x.status})`)
        .join('; ');
      console.log([c.id, c.about, p.pillar, shown, p.score, '', '', ''].map(csv).join(','));
    }
    const unscored = result.unscored.map(
      (u) => `${u.marker_code}=${u.value} (${u.excluded_reason})`,
    );
    console.log(
      [
        c.id,
        c.about,
        'OVERALL',
        unscored.length ? `unscored: ${unscored.join('; ')}` : '',
        result.overall,
        '',
        '',
        '',
      ]
        .map(csv)
        .join(','),
    );
  }
  console.error(
    `scoring ${SCORING_VERSION}, placeholder ranges — every engine score is provisional`,
  );
}
