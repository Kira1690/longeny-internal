/**
 * Placeholder reference ranges — for development and demos only.
 *
 * Clinically reviewed ranges have not been supplied yet. Until they are, these
 * rows let the benchmark endpoints return something to build a screen against.
 * Every row is `is_placeholder = true`, so every verdict judged against one is
 * returned as `provisional` and must not be shown as a clinical result.
 *
 * Re-runnable: it replaces only its own rows (matched by `source`), and never
 * touches a range that has been marked real.
 *
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/src/db/seed-placeholder-ranges.ts
 *
 * Replacing them: insert the reviewed rows with `is_placeholder = false` and a
 * real `source`, then set `retired_at` on these. No code change is needed.
 */
import postgres from 'postgres';

const url = process.env.AI_CONTENT_DATABASE_URL;
if (!url) throw new Error('AI_CONTENT_DATABASE_URL must be set');

const SOURCE = 'PLACEHOLDER — not clinically reviewed; replace before clinical use';

// [code, name, unit, pillar, normalLow, normalHigh, optimalLow, optimalHigh]
const ROWS: Array<
  [string, string, string, string, number | null, number | null, number | null, number | null]
> = [
  ['hba1c', 'HbA1c', '%', 'nutrition', 4.0, 5.6, 4.5, 5.2],
  ['fasting_glucose', 'Fasting glucose', 'mg/dL', 'nutrition', 70, 99, 75, 90],
  ['ldl_c', 'LDL cholesterol', 'mg/dL', 'nutrition', null, 130, null, 100],
  ['hdl_c', 'HDL cholesterol', 'mg/dL', 'movement', 40, null, 60, null],
  ['triglycerides', 'Triglycerides', 'mg/dL', 'nutrition', null, 150, null, 100],
  ['vitamin_d', 'Vitamin D (25-OH)', 'ng/mL', 'environment', 20, 100, 30, 60],
  ['tsh', 'TSH', 'mIU/L', 'stress', 0.4, 4.0, 1.0, 2.5],
];

const sql = postgres(url, { max: 1 });

try {
  await sql.begin(async (tx) => {
    const removed = await tx`
      DELETE FROM reference_ranges WHERE source = ${SOURCE} AND is_placeholder = true
    `;
    for (const [code, name, unit, pillar, nLow, nHigh, oLow, oHigh] of ROWS) {
      await tx`
        INSERT INTO reference_ranges
          (marker_code, marker_name, unit, sex, normal_low, normal_high,
           optimal_low, optimal_high, pillar, source, is_placeholder)
        VALUES
          (${code}, ${name}, ${unit}, 'any', ${nLow}, ${nHigh},
           ${oLow}, ${oHigh}, ${pillar}::rro_pillar, ${SOURCE}, true)
      `;
    }
    console.log(`placeholder ranges: removed ${removed.count}, inserted ${ROWS.length}`);
  });
} finally {
  await sql.end();
}
