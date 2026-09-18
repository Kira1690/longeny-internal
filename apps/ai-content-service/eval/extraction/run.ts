/**
 * Run the extraction eval against Bedrock (P-W8-1).
 *
 *   bun run apps/ai-content-service/eval/extraction/run.ts
 *
 * Needs model access. While Bedrock is blocked on the account's billing this
 * stops at the first call and says so — the prompt, the eval set and the scorer
 * are the work; running it is an afternoon once access returns.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readingExtractionOutputSchema } from '@longeny/validators';
import { explicitAwsCredentials } from '../../src/config/aws.js';
import { config } from '../../src/config/index.js';
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
} from '../../src/services/rro/extraction-prompt.js';
import { EXTRACTION_FIXTURES } from './fixtures.js';
import { type ExtractionCaseScore, scoreExtraction, summariseExtraction } from './score.js';

const client = new BedrockRuntimeClient({
  region: config.AWS_BEDROCK_REGION,
  ...explicitAwsCredentials(),
});

const scores: ExtractionCaseScore[] = [];
for (const f of EXTRACTION_FIXTURES) {
  let text: string;
  try {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: config.BEDROCK_MODEL_ID_RRO,
        contentType: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          temperature: 0,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildExtractionPrompt(f.text) }],
        }),
      }),
    );
    text = JSON.parse(new TextDecoder().decode(res.body)).content?.[0]?.text ?? '';
  } catch (err) {
    console.error(`Model call failed on ${f.id}: ${(err as Error).message}`);
    console.error('Bedrock access is required to run this eval. Nothing was scored.');
    process.exit(2);
  }
  const parsed = readingExtractionOutputSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    console.log(`  ${f.id}: CONTRACT-INVALID — ${parsed.error.issues[0]?.message}`);
    scores.push({
      perReading: f.expected.map((e) => ({
        printedName: e.printedName,
        verdict: 'missed',
        uncertaintyOk: false,
      })),
      extra: 0,
    });
    continue;
  }
  const s = scoreExtraction(f.expected, parsed.data);
  scores.push(s);
  for (const r of s.perReading.filter((x) => x.verdict !== 'correct' || !x.uncertaintyOk)) {
    console.log(
      `  ${f.id}: ${r.printedName} → ${r.verdict}${r.uncertaintyOk ? '' : ' (should be uncertain)'}`,
    );
  }
}

const sum = summariseExtraction(scores);
console.log(
  `\nExtraction eval — ${config.BEDROCK_MODEL_ID_RRO}, prompt ${EXTRACTION_PROMPT_VERSION}`,
);
console.log(`  values expected              ${sum.expected}`);
console.log(`  accuracy (of values found)   ${sum.accuracy.hit}/${sum.accuracy.of}`);
console.log(`  MISSED SILENTLY              ${sum.missRate.silent}/${sum.missRate.of}`);
console.log(`  missed but declared          ${sum.missRate.declared}`);
console.log(
  `  wrong value / unit / code    ${sum.wrongValue} / ${sum.wrongUnit} / ${sum.wrongCode}`,
);
console.log(`  unsure values not flagged    ${sum.uncertaintyMissed}`);
console.log(`  extra values (ref interval?) ${sum.extra}`);
