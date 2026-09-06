/**
 * End-to-end tests for the RRO classifier and pre-consult summary (Week 7,
 * cards W7-5 and W7-6).
 *
 * Real services, real PostgreSQL, real Redis — no mocks. Requires
 * user-provider-service on :3002 and ai-content-service on :3004.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/ai-classify.e2e.ts
 *
 * What is being defended here is narrow and important: a classification may only
 * move a profile through the care pathway when the provider did not refuse, the
 * confidence clears the floor, and the taxonomy permits the move. Everything
 * else is stored and marked as not having transitioned, with the reason.
 */
import crypto from 'node:crypto';
import {
  RRO_CONTRACT_VERSION,
  RRO_MIN_CLASSIFIER_CONFIDENCE,
  rroClassifierResponseSchema,
  rroSummaryResponseSchema,
} from '@longeny/validators';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { RroRulesProvider } from '../src/services/rro/rules-provider.js';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();

const PERMISSIONS = ['profiles:read', 'profiles:write', 'intake:read', 'intake:write', 'rro:read'];

const authHeaders = {
  Authorization: `Bearer ${jwt.sign(
    {
      sub: AUTH_ID,
      email: `w7ai-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: PERMISSIONS,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn: '15m' },
  )}`,
  'Content-Type': 'application/json',
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function hmacHeaders(method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', HMAC_SECRET as string)
    .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256(body)}`)
    .digest('hex');
  return {
    'X-Service-Name': 'test-harness',
    'X-Timestamp': timestamp,
    'X-Signature': signature,
    'Content-Type': 'application/json',
  };
}

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function call(res: Response) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as any };
  } catch {
    return { status: res.status, body: text as any };
  }
}

const post = (path: string, payload: unknown, base = BASE) => {
  const body = JSON.stringify(payload);
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: hmacHeaders('POST', path, body),
    body,
  });
};

// ── Preflight ────────────────────────────────────────────────────────────────

for (const [name, url] of [
  ['ai-content', `${BASE}/health`],
  ['user-provider', `${USER_PROVIDER}/health`],
] as const) {
  try {
    const health = await fetch(url);
    if (!health.ok) throw new Error(`health returned ${health.status}`);
  } catch (err) {
    console.error(`${name} not reachable at ${url} — start it first.\n  ${err}`);
    process.exit(1);
  }
}

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);

await core`
  INSERT INTO users (auth_id, email, first_name, last_name)
  VALUES (${AUTH_ID}::uuid, ${`w7ai-${RUN}@longeny.test`}, 'Classify', 'Test')
  ON CONFLICT (auth_id) DO NOTHING
`;

let r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'father', firstName: `Dad-${RUN}` }),
  }),
);
const dadId: string = r.body.data?.id;
check('fixture profile created', r.status === 201 && Boolean(dadId), r);

r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'mother', firstName: `Mum-${RUN}` }),
  }),
);
const mumId: string = r.body.data?.id;

// ── 1. No intake, nothing to classify ────────────────────────────────────────

console.log('\n1. A profile with no intake cannot be classified');

r = await call(await post('/internal/ai/classify', { profileId: mumId }));
check('404 — there is nothing to reason about', r.status === 404, r);

let rows = await ai`SELECT id FROM rro_classifications WHERE profile_id = ${mumId}::uuid`;
check('and nothing was stored', rows.length === 0, rows);

// ── 2. A real classification ─────────────────────────────────────────────────

console.log('\n2. Intake → classify');

await fetch(`${BASE}/intake`, {
  method: 'POST',
  headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
  body: JSON.stringify({
    symptoms: ['fatigue in the afternoon', 'joint stiffness on waking', 'poor sleep'],
    goals: ['reverse prediabetes'],
    conditions: ['prediabetes'],
    medications: ['metformin 500mg'],
    pillarPriorities: ['nutrition', 'sleep'],
  }),
});

r = await call(await post('/internal/ai/classify', { profileId: dadId, ageBand: '40_59' }));
check('200 OK', r.status === 200, r);
const classification = r.body.data;
check(
  'a state was chosen',
  ['intake', 'reverse', 'restore', 'optimise'].includes(classification?.state),
  classification,
);
check(
  'conditions and three symptoms place the profile in reverse',
  classification?.state === 'reverse',
  classification,
);
check(
  'the contract version is recorded',
  classification?.contract_version === RRO_CONTRACT_VERSION,
  classification,
);
check(
  'so is the prompt version',
  typeof classification?.prompt_version === 'string' && classification.prompt_version.length > 0,
  classification,
);
check(
  'the intake version it was derived from is recorded',
  classification?.intake_version === 1,
  classification,
);
check(
  'pillars are ranked',
  Array.isArray(classification?.pillar_priorities) &&
    classification.pillar_priorities[0] === 'nutrition',
  classification,
);

rows = await ai`
  SELECT provider, state, confidence, transitioned, not_transitioned_reason, intake_id
  FROM rro_classifications WHERE profile_id = ${dadId}::uuid
`;
check('the database holds exactly one classification', rows.length === 1, rows);
check('it points at the intake it used', Boolean(rows[0]?.intake_id), rows[0]);

// ── 3. The confidence floor ──────────────────────────────────────────────────

console.log('\n3. The deterministic provider is advisory and cannot move a profile');

const confidence = Number(rows[0]?.confidence);
check(
  `confidence ${confidence} is below the ${RRO_MIN_CLASSIFIER_CONFIDENCE} transition floor`,
  confidence < RRO_MIN_CLASSIFIER_CONFIDENCE,
  rows[0],
);
check('so the profile was not moved', rows[0]?.transitioned === false, rows[0]);
check('and the reason is recorded', rows[0]?.not_transitioned_reason === 'low_confidence', rows[0]);

r = await call(
  await fetch(`${USER_PROVIDER}/profiles/${dadId}/rro-state`, { headers: authHeaders }),
);
check('the profile is still where it was', r.body.data?.current_state === 'intake', r.body.data);

// The cap is a property of the provider, not of one input: no intake, however
// complete, can produce a rules result that clears the floor.
const rules = new RroRulesProvider();
const bestCase = await rules.classify({
  profileId: dadId,
  intake: {
    symptoms: ['a', 'b', 'c'],
    goals: ['g'],
    conditions: ['c'],
    medications: ['m'],
    pillarPriorities: ['nutrition', 'sleep', 'stress', 'movement', 'environment'],
  },
  history: [],
});
check(
  'even a fully answered intake stays under the floor',
  !('refused' in bestCase) && bestCase.confidence < RRO_MIN_CLASSIFIER_CONFIDENCE,
  bestCase,
);

// ── 4. Refusal rather than invention ─────────────────────────────────────────

console.log('\n4. An empty intake is refused, not guessed at');

await fetch(`${BASE}/intake`, {
  method: 'POST',
  headers: { ...authHeaders, 'X-Active-Profile-Id': mumId },
  body: JSON.stringify({
    symptoms: [],
    goals: [],
    conditions: [],
    medications: [],
    pillarPriorities: [],
  }),
});

r = await call(await post('/internal/ai/classify', { profileId: mumId }));
check('200 — a refusal is valid output, not an error', r.status === 200, r);
check('no state was invented', r.body.data?.state === null, r.body.data);
check(
  'the refusal reason is insufficient_data',
  r.body.data?.refused_reason === 'insufficient_data',
  r.body.data,
);
check('and it did not transition', r.body.data?.transitioned === false, r.body.data);
check(
  'the reason for not transitioning is the refusal itself',
  r.body.data?.not_transitioned_reason === 'refused',
  r.body.data,
);

// ── 5. The taxonomy decides which moves are legal ────────────────────────────

console.log('\n5. RRO transitions are validated against the taxonomy');

r = await call(
  await post(
    '/internal/rro-state/transition',
    { profileId: dadId, toState: 'optimise', reason: 'skip ahead', source: 'clinician' },
    USER_PROVIDER,
  ),
);
check('intake → optimise is refused with 422', r.status === 422, r);
check('and named INVALID_TRANSITION', r.body.error?.code === 'INVALID_TRANSITION', r.body.error);

r = await call(
  await fetch(`${USER_PROVIDER}/profiles/${dadId}/rro-state`, { headers: authHeaders }),
);
check('the refused move changed nothing', r.body.data?.current_state === 'intake', r.body.data);

r = await call(
  await post(
    '/internal/rro-state/transition',
    { profileId: dadId, toState: 'reverse', reason: 'clinician review', source: 'clinician' },
    USER_PROVIDER,
  ),
);
check('intake → reverse is permitted', r.status === 200, r);
check('and reports where it came from', r.body.data?.fromState === 'intake', r.body.data);

const transitionRows = await core`
  SELECT from_state, to_state, source FROM rro_transition
  WHERE profile_id = ${dadId}::uuid ORDER BY created_at
`;
check(
  'the refused move left no history row',
  !transitionRows.some((row: any) => row.to_state === 'optimise'),
  transitionRows,
);
check(
  'the permitted one did',
  transitionRows.some((row: any) => row.to_state === 'reverse' && row.source === 'clinician'),
  transitionRows,
);

// ── 6. Classifying a profile already in that state ───────────────────────────

console.log('\n6. A classification that names the current state is not a move');

r = await call(await post('/internal/ai/classify', { profileId: dadId, ageBand: '40_59' }));
check('200 OK', r.status === 200, r);
check(
  'the state matches where the profile already is',
  r.body.data?.state === 'reverse',
  r.body.data,
);
check('so it is recorded as no move', r.body.data?.transitioned === false, r.body.data);
check(
  'with that as the reason',
  r.body.data?.not_transitioned_reason === 'already_in_state',
  r.body.data,
);

rows = await ai`SELECT id FROM rro_classifications WHERE profile_id = ${dadId}::uuid`;
check(
  'every attempt is kept, including the ones that changed nothing',
  rows.length === 2,
  rows.length,
);

// ── 7. The contract is the gate ──────────────────────────────────────────────

console.log('\n7. Output that does not fit the contract is rejected, never coerced');

const invented = rroClassifierResponseSchema.safeParse({
  contractVersion: RRO_CONTRACT_VERSION,
  state: 'transcend',
  confidence: 0.95,
  pillarPriorities: ['nutrition'],
  rationale: 'plausible-sounding nonsense',
  missingData: [],
});
check('a state outside the taxonomy fails the contract', invented.success === false, invented);

const overconfident = rroClassifierResponseSchema.safeParse({
  contractVersion: RRO_CONTRACT_VERSION,
  state: 'reverse',
  confidence: 1.4,
  pillarPriorities: ['nutrition'],
  rationale: 'out of range',
  missingData: [],
});
check(
  'a confidence outside 0–1 fails the contract',
  overconfident.success === false,
  overconfident,
);

const wrongVersion = rroClassifierResponseSchema.safeParse({
  contractVersion: 'v99',
  refused: true,
  reason: 'insufficient_data',
  detail: 'from a contract we do not speak',
});
check(
  'output from an unknown contract version is rejected',
  wrongVersion.success === false,
  wrongVersion,
);

// ── 8. Pre-consult summary ───────────────────────────────────────────────────

console.log('\n8. Pre-consult summary');

r = await call(await post('/internal/ai/summary', { profileId: dadId }));
check('200 OK', r.status === 200, r);
check(
  'concerns are drawn from the intake',
  (r.body.data?.concerns ?? []).some((c: string) => c.includes('prediabetes')),
  r.body.data,
);
check(
  'sufficient_data is true for a real intake',
  r.body.data?.sufficient_data === true,
  r.body.data,
);
check(
  'it records the intake version it summarised',
  r.body.data?.intake_version === 1,
  r.body.data,
);

r = await call(await post('/internal/ai/summary', { profileId: mumId }));
check(
  'an empty intake yields a refusal, not an invented summary',
  r.body.data?.sufficient_data === false,
  r.body.data,
);
check('with no concerns', (r.body.data?.concerns ?? []).length === 0, r.body.data);
check('and no red flags', (r.body.data?.red_flags ?? []).length === 0, r.body.data);

console.log('\n9. A red flag surfaces with its urgency');

await fetch(`${BASE}/intake`, {
  method: 'POST',
  headers: { ...authHeaders, 'X-Active-Profile-Id': mumId },
  body: JSON.stringify({
    symptoms: ['chest pain when climbing stairs', 'breathless at night'],
    goals: ['feel safe exercising'],
    conditions: [],
    medications: [],
    pillarPriorities: ['movement'],
  }),
});

r = await call(await post('/internal/ai/summary', { profileId: mumId }));
const redFlags = r.body.data?.red_flags ?? [];
check(
  'the chest-pain report is flagged',
  redFlags.some((f: any) => f.finding.includes('chest pain')),
  redFlags,
);
check(
  'as an emergency',
  redFlags.some((f: any) => f.severity === 'emergency'),
  redFlags,
);
check(
  'with a reason a clinician can read',
  redFlags.every((f: any) => typeof f.basis === 'string' && f.basis.length > 0),
  redFlags,
);
check(
  'and it is not a diagnosis',
  !JSON.stringify(redFlags).toLowerCase().includes('you have'),
  redFlags,
);

const summaryShape = rroSummaryResponseSchema.safeParse({
  contractVersion: RRO_CONTRACT_VERSION,
  concerns: [],
  missingData: [],
  redFlags: [{ finding: 'x', severity: 'catastrophic', basis: 'y' }],
  suggestedQuestions: [],
  sufficientData: true,
});
check('a severity outside the contract is rejected', summaryShape.success === false, summaryShape);

// ── 10. Stored results are readable, and staleness is visible ────────────────

console.log('\n10. Reading stored results');

r = await call(await fetch(`${BASE}/rro/${dadId}/classification`, { headers: authHeaders }));
check(
  'the owner reads the latest classification',
  r.status === 200 && r.body.data?.state === 'reverse',
  r.body.data,
);
check(
  'confidence comes back as a number, not a string',
  typeof r.body.data?.confidence === 'number',
  r.body.data,
);

r = await call(await fetch(`${BASE}/rro/${mumId}/summary`, { headers: authHeaders }));
check('the summary is readable', r.status === 200, r);
check('and is current for the intake it describes', r.body.data?.stale === false, r.body.data);

await fetch(`${BASE}/intake`, {
  method: 'POST',
  headers: { ...authHeaders, 'X-Active-Profile-Id': mumId },
  body: JSON.stringify({
    symptoms: ['chest pain when climbing stairs'],
    goals: [],
    conditions: [],
    medications: [],
    pillarPriorities: [],
  }),
});

r = await call(await fetch(`${BASE}/rro/${mumId}/summary`, { headers: authHeaders }));
check(
  'after the intake is resubmitted the summary reports itself stale',
  r.body.data?.stale === true,
  r.body.data,
);

// ── 11. Who may reach any of this ────────────────────────────────────────────

console.log('\n11. Access');

r = await call(
  await fetch(`${BASE}/internal/ai/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: dadId }),
  }),
);
check('an unsigned internal call → 401', r.status === 401, r);

r = await call(
  await fetch(`${BASE}/internal/ai/classify`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ profileId: dadId }),
  }),
);
check('a user token does not open an internal route → 401', r.status === 401, r);

r = await call(await post('/internal/ai/classify', { profileId: 'not-a-uuid' }));
check('a malformed body → 400', r.status === 400, r);

r = await call(await fetch(`${BASE}/rro/${dadId}/classification`));
check('reading without a token → 401', r.status === 401, r);

const strangerHeaders = {
  Authorization: `Bearer ${jwt.sign(
    {
      sub: crypto.randomUUID(),
      email: `stranger-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: PERMISSIONS,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn: '15m' },
  )}`,
  'Content-Type': 'application/json',
};
r = await call(await fetch(`${BASE}/rro/${dadId}/classification`, { headers: strangerHeaders }));
check('another account reading it → 404, never 403', r.status === 404, r);

// ── Teardown ─────────────────────────────────────────────────────────────────

for (const id of [dadId, mumId]) {
  if (id)
    await fetch(`${USER_PROVIDER}/profiles/${id}`, { method: 'DELETE', headers: authHeaders });
}
await core.end();
await ai.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
