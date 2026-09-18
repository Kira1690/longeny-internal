/**
 * Read a filled score-validation sheet and report the disagreements (P-W8-2).
 *
 *   bun run apps/ai-content-service/eval/score-validation/compare.ts score-validation.csv
 *
 * The disagreements are the deliverable, not the agreement rate. The worst
 * kind is listed first: the engine scoring a case healthier than the clinician
 * did, because that is the case that harms someone.
 */
const path = process.argv[2];
if (!path) {
  console.error('usage: compare.ts <filled.csv>');
  process.exit(2);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const [header, ...rows] = parseCsv(await Bun.file(path).text());
const col = (name: string) => header?.indexOf(name) ?? -1;
const THRESHOLD = 15;

const scored = rows
  .filter((r) => r[col('clinician_score')]?.trim())
  .map((r) => ({
    id: r[col('case')],
    pillar: r[col('pillar')],
    about: r[col('about')],
    engine: Number(r[col('engine_score')]),
    clinician: Number(r[col('clinician_score')]),
    category: r[col('category')] || '(uncategorised)',
    note: r[col('note')] ?? '',
  }));

const overRated = scored.filter((s) => s.engine - s.clinician >= THRESHOLD);
const underRated = scored.filter((s) => s.clinician - s.engine >= THRESHOLD);

console.log(`Rows scored by a clinician: ${scored.length} of ${rows.length}`);
console.log(`\nENGINE HEALTHIER THAN THE CLINICIAN (≥${THRESHOLD} points) — ${overRated.length}`);
for (const s of overRated) {
  console.log(
    `  ${s.id} ${s.pillar}: engine ${s.engine}, clinician ${s.clinician} — ${s.category}. ${s.note}`,
  );
}
console.log(`\nEngine harsher than the clinician (≥${THRESHOLD} points) — ${underRated.length}`);
for (const s of underRated) {
  console.log(
    `  ${s.id} ${s.pillar}: engine ${s.engine}, clinician ${s.clinician} — ${s.category}. ${s.note}`,
  );
}
const byCategory = new Map<string, number>();
for (const s of [...overRated, ...underRated]) {
  byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
}
console.log('\nDisagreements by category:');
for (const [k, v] of byCategory) console.log(`  ${k}: ${v}`);
