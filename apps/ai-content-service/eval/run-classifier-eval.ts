/**
 * Run the RRO classifier and summary evals against a provider.
 *
 *   bun run apps/ai-content-service/eval/run-classifier-eval.ts            # rules baseline
 *   bun run apps/ai-content-service/eval/run-classifier-eval.ts bedrock    # the model (needs access)
 *
 * Every output is parsed against the same contract schema the service uses, so
 * a response the service would reject is counted as invalid here too, never
 * coerced into a score. Exits 1 only when the rules baseline breaks the
 * contract — a low score is a measurement, not a failure.
 */
import crypto from 'node:crypto';
import { rroClassifierResponseSchema, rroSummaryResponseSchema } from '@longeny/validators';
import { RroBedrockProvider } from '../src/services/rro/bedrock-provider.js';
import type { RroAiProvider } from '../src/services/rro/provider.js';
import { RroRulesProvider } from '../src/services/rro/rules-provider.js';
import { CLASSIFIER_FIXTURES, SUMMARY_FIXTURES } from './classifier-fixtures.js';
import {
  type CaseResult,
  scoreClassifierCase,
  scoreSummaryCase,
  summariseClassifier,
} from './score-classifier.js';

const which = process.argv[2] ?? 'rules';
const provider: RroAiProvider =
  which === 'bedrock' ? new RroBedrockProvider() : new RroRulesProvider();

const pct = ({ hit, of }: { hit: number; of: number }) =>
  of === 0 ? 'n/a' : `${hit}/${of} (${Math.round((hit / of) * 100)}%)`;

const results: CaseResult[] = [];
for (const f of CLASSIFIER_FIXTURES) {
  try {
    const raw = await provider.classify({
      profileId: crypto.randomUUID(),
      intake: f.intake,
      history: [],
      ageBand: f.ageBand,
    });
    const parsed = rroClassifierResponseSchema.safeParse(raw);
    results.push(
      scoreClassifierCase(
        f,
        parsed.success
          ? { kind: 'output', value: parsed.data }
          : { kind: 'invalid', error: parsed.error.issues[0]?.message ?? 'contract' },
      ),
    );
  } catch (err) {
    results.push(scoreClassifierCase(f, { kind: 'invalid', error: String(err) }));
  }
}

const s = summariseClassifier(results);
console.log(
  `\nRRO classifier eval — provider: ${provider.name}${provider.modelId ? ` (${provider.modelId})` : ''}`,
);
console.log(`Fixtures: ${s.cases} (all DRAFT until clinically reviewed)\n`);
console.log(`  state, strict      ${pct(s.strictState)}`);
console.log(`  state, lenient     ${pct(s.lenientState)}`);
console.log(`  refusals correct   ${pct(s.refusals)}`);
console.log(`  top pillar         ${pct(s.topPillar)}`);
console.log(`  must-have top 3    ${pct(s.topThree)}`);
console.log(`  contract-invalid   ${s.invalid}`);
console.log('\n  misses:');
for (const r of results.filter((x) => !x.strict)) {
  console.log(`    ${r.id.padEnd(7)} expected ${r.expected.padEnd(9)} got ${r.got}`);
}

let flagsFound = 0;
let flagsExpected = 0;
let invented = 0;
let sufficiency = 0;
const summaryLines: string[] = [];
for (const f of SUMMARY_FIXTURES) {
  let out: Parameters<typeof scoreSummaryCase>[1];
  try {
    const raw = await provider.summarise({
      profileId: crypto.randomUUID(),
      intake: f.intake,
      currentState: 'intake',
      reports: [],
    });
    const parsed = rroSummaryResponseSchema.safeParse(raw);
    out = parsed.success ? parsed.data : { invalid: parsed.error.issues[0]?.message ?? 'contract' };
  } catch (err) {
    out = { invalid: String(err) };
  }
  const r = scoreSummaryCase(f, out);
  flagsFound += r.flagsFound;
  flagsExpected += r.flagsExpected;
  invented += r.unexpectedFlags;
  if (r.sufficientCorrect) sufficiency++;
  if (r.flagsFound < r.flagsExpected || r.unexpectedFlags > 0 || !r.sufficientCorrect) {
    summaryLines.push(`    ${r.id.padEnd(6)} ${f.about} — got ${r.detail}`);
  }
}

console.log(`\nPre-consult summary red flags — ${SUMMARY_FIXTURES.length} fixtures`);
console.log(`  red flags found (right severity)  ${flagsFound}/${flagsExpected}`);
console.log(`  flags invented on a clean intake  ${invented}`);
console.log(`  sufficiency judged right          ${sufficiency}/${SUMMARY_FIXTURES.length}`);
if (summaryLines.length > 0) {
  console.log('\n  misses:');
  for (const line of summaryLines) console.log(line);
}
console.log('');

process.exit(which === 'rules' && s.invalid > 0 ? 1 : 0);
