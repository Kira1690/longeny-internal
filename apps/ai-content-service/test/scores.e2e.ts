/**
 * End-to-end tests for pillar and overall RRO scores (Week 8, V-W8-5, V-W8-6).
 *
 * Real services, real PostgreSQL — no mocks. The whole chain runs through the
 * API: report → readings → benchmark → score. The rule this suite exists for:
 * a score never moves a profile between care stages.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/scores.e2e.ts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET || !process.env.HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();
const OTHER_AUTH_ID = crypto.randomUUID();
const PROVIDER_AUTH_ID = crypto.randomUUID();
const MK = (name: string) => `sc${RUN}_${name}`;
const GLUCOSE = MK('glucose');
const SLEEP = MK('sleep_marker');
const NORANGE = MK('norange');
const WRONGUNIT = MK('wrongunit');

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: `w8sc-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: ['profiles:read', 'profiles:write', 'documents:read', 'documents:write'],
      jti: crypto.randomUUID(),
      ...claims,
    },
    JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const json = { 'Content-Type': 'application/json' };
const authHeaders = { Authorization: `Bearer ${mintToken()}`, ...json };
const otherHeaders = {
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w8sc-o-${RUN}@longeny.test` })}`,
  ...json,
};
const providerHeaders = {
  Authorization: `Bearer ${mintToken({
    sub: PROVIDER_AUTH_ID,
    email: `w8sc-doc-${RUN}@longeny.test`,
    role: 'provider',
    roles: ['provider'],
    permissions: ['documents:read', 'profiles:read'],
  })}`,
  ...json,
};

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
const post = async (url: string, body: unknown, headers: Record<string, string> = authHeaders) =>
  call(await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }));
const get = async (url: string, headers: Record<string, string> = authHeaders) =>
  call(await fetch(url, { headers }));

for (const url of [`${BASE}/health`, `${USER_PROVIDER}/health`]) {
  try {
    if (!(await fetch(url)).ok) throw new Error('not ok');
  } catch (err) {
    console.error(`${url} not reachable — start it first.\n  ${err}`);
    process.exit(1);
  }
}

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);

for (const [authId, label] of [
  [AUTH_ID, 'own'],
  [OTHER_AUTH_ID, 'other'],
] as const) {
  await core`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (${authId}::uuid, ${`w8sc-${label}-${RUN}@longeny.test`}, ${`W8${label}`}, 'Scores')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

let r = await post(`${USER_PROVIDER}/profiles`, { relation: 'father', firstName: `Dad-${RUN}` });
const dadId: string = r.body.data?.id;
check('fixture profile created', r.status === 201 && Boolean(dadId), r);

const stateBefore =
  await core`SELECT current_state FROM rro_state WHERE profile_id = ${dadId}::uuid`;
const transitionsBefore = await core`
  SELECT count(*)::int AS n FROM rro_transition WHERE profile_id = ${dadId}::uuid
`;

const rangeIds: string[] = [];
for (const [code, pillar, unit, low, high, oLow, oHigh] of [
  [GLUCOSE, 'nutrition', 'mg/dL', 70, 99, 75, 90],
  [SLEEP, 'sleep', 'u', 10, 20, 12, 18],
  [WRONGUNIT, 'movement', 'mg/dL', 1, 2, null, null],
] as const) {
  const [row] = await ai`
    INSERT INTO reference_ranges
      (marker_code, marker_name, unit, normal_low, normal_high, optimal_low, optimal_high, pillar, source)
    VALUES (${code}, ${code}, ${unit}, ${low}, ${high}, ${oLow}, ${oHigh}, ${pillar}::rro_pillar, ${`e2e ${RUN}`})
    RETURNING id
  `;
  rangeIds.push(row.id);
}

const up = await post(
  `${BASE}/documents/upload`,
  {
    title: `Panel ${RUN}`,
    fileName: 'panel.pdf',
    fileSize: 2048,
    mimeType: 'application/pdf',
    documentType: 'lab_report',
    reportedAt: '2026-09-01T08:00:00.000Z',
  },
  { ...authHeaders, 'X-Active-Profile-Id': dadId },
);
const reportId: string = up.body.data?.documentId;

r = await post(`${BASE}/reports/${reportId}/readings`, {
  readings: [
    { markerCode: GLUCOSE, value: 82, unit: 'mg/dL' }, // optimal → 100
    { markerCode: SLEEP, value: 8, unit: 'u' }, // low → 30
    { markerCode: NORANGE, value: 5, unit: 'u' }, // no reference
    { markerCode: WRONGUNIT, value: 5, unit: 'mmol/L' }, // unit mismatch
  ],
});
check('a panel entered through the readings API', r.status === 201, r);
const sleepReading = (r.body.data ?? []).find((x: any) => x.marker_code === SLEEP);

// ── 1. Before any score ──────────────────────────────────────────────────────

console.log('\n1. No score yet');

r = await get(`${BASE}/profiles/${dadId}/scores`);
check('GET before any score → 404', r.status === 404, r);

// ── 2. Computing ─────────────────────────────────────────────────────────────

console.log('\n2. POST /profiles/:id/scores');

r = await post(`${BASE}/profiles/${dadId}/scores`, {});
check('201 Created', r.status === 201, r);
const first = r.body.data;
const pillar = (name: string) => first?.pillars?.find((p: any) => p.pillar === name);
check(
  'nutrition is 100 (optimal glucose)',
  pillar('nutrition')?.score === 100,
  pillar('nutrition'),
);
check('sleep is 30 (low)', pillar('sleep')?.score === 30, pillar('sleep'));
check('a pillar with no readings is null', pillar('stress')?.score === null, pillar('stress'));
check(
  'movement is null — its only reading was in the wrong unit',
  pillar('movement')?.score === null,
  pillar('movement'),
);
check('overall averages only the pillars with data: (100 + 30) / 2', first?.overall === 65, first);
check(
  'the unscored readings are listed with the reason',
  JSON.stringify(first?.unscored?.map((u: any) => u.excluded_reason).sort()) ===
    JSON.stringify(['no_reference', 'unit_mismatch']),
  first?.unscored,
);
check('it names its rule set', typeof first?.scoring_version === 'string', first);
check('it is advisory', first?.advisory === true, first);
check('and provisional while the rules are placeholders', first?.provisional === true, first);
check(
  'each contribution names its reading and range',
  Boolean(pillar('nutrition')?.contributions[0]?.range_id),
);

// ── 3. Advisory: the care stage does not move ────────────────────────────────

console.log('\n3. A score never moves a profile between care stages');

const stateAfter =
  await core`SELECT current_state FROM rro_state WHERE profile_id = ${dadId}::uuid`;
const transitionsAfter = await core`
  SELECT count(*)::int AS n FROM rro_transition WHERE profile_id = ${dadId}::uuid
`;
check('no transition row was written', transitionsAfter[0]?.n === transitionsBefore[0]?.n, {
  before: transitionsBefore[0]?.n,
  after: transitionsAfter[0]?.n,
});
check('the care stage is unchanged', JSON.stringify(stateAfter) === JSON.stringify(stateBefore), {
  before: stateBefore,
  after: stateAfter,
});

// ── 4. Stored, reused, stale ─────────────────────────────────────────────────

console.log('\n4. Stored, reused when nothing changed, stale when something did');

r = await post(`${BASE}/profiles/${dadId}/scores`, {});
check(
  'nothing changed → 200 with the same score',
  r.status === 200 && r.body.data?.id === first?.id,
  r,
);
check('meta says it was reused', r.body.meta?.reused === true, r.body.meta);

r = await get(`${BASE}/profiles/${dadId}/scores`);
check('GET returns the latest', r.status === 200 && r.body.data?.id === first?.id, r);
check('and it is not stale', r.body.data?.stale === false, r.body.data);

r = await post(`${BASE}/readings/${sleepReading?.id}/corrections`, { value: 15, unit: 'u' });
check('the sleep reading is corrected to an optimal value', r.status === 201, r);

r = await get(`${BASE}/profiles/${dadId}/scores`);
check('the stored score is now stale', r.body.data?.stale === true, r.body.data);
check('but still says what it said', r.body.data?.overall === 65, r.body.data);

r = await post(`${BASE}/profiles/${dadId}/scores`, {});
check('a fresh score → 201', r.status === 201, r);
const second = r.body.data;
check('sleep is now 100, overall 100', second?.overall === 100, second);

const stored =
  await ai`SELECT count(*)::int AS n FROM rro_scores WHERE profile_id = ${dadId}::uuid`;
check('both scores are kept', stored[0]?.n === 2, stored);

// ── 5. Recompute gives the identical answer ──────────────────────────────────

console.log('\n5. Recomputed from stored readings, the score is identical');

await ai`DELETE FROM rro_scores WHERE id = ${second?.id}::uuid`;
r = await post(`${BASE}/profiles/${dadId}/scores`, {});
const strip = (s: any) => {
  const { id, computed_at, stale, ...rest } = s ?? {};
  return JSON.stringify(rest);
};
check('a new row', r.status === 201 && r.body.data?.id !== second?.id, r);
check('with exactly the same result, explanation included', strip(r.body.data) === strip(second));

// ── 6. Access ────────────────────────────────────────────────────────────────

console.log('\n6. Access');

r = await post(`${BASE}/profiles/${dadId}/scores`, {}, otherHeaders);
check('another account cannot compute → 404', r.status === 404, r);
r = await get(`${BASE}/profiles/${dadId}/scores`, otherHeaders);
check('nor read → 404', r.status === 404, r);
r = await get(`${BASE}/profiles/${dadId}/scores`, providerHeaders);
check('a provider with no booking → 404', r.status === 404, r);
r = await call(await fetch(`${BASE}/profiles/${dadId}/scores`));
check('no token → 401', r.status === 401, r);
r = await get(`${BASE}/profiles/not-a-uuid/scores`);
check('a malformed profile id → 400', r.status === 400, r);

try {
  await fetch(`${GATEWAY}/health`);
  r = await get(`${GATEWAY}/api/v1/profiles/${dadId}/scores`);
  check('GET through the gateway', r.status === 200, r.status);
  r = await post(`${GATEWAY}/api/v1/profiles/${dadId}/scores`, {});
  check('POST through the gateway', r.status === 200 || r.status === 201, r.status);
} catch {
  check('gateway reachable', false, `${GATEWAY} not running`);
}

const audit = await ai`
  SELECT actor_id, success FROM phi_access_log
  WHERE action = 'scores.access' AND profile_id = ${dadId}::uuid
`;
check(
  'score access is audited',
  audit.some((x: any) => x.actor_id === AUTH_ID && x.success),
);
check(
  'and so is the refusal',
  audit.some((x: any) => x.actor_id === OTHER_AUTH_ID && !x.success),
);

// ── Teardown ─────────────────────────────────────────────────────────────────

await ai`DELETE FROM rro_scores WHERE profile_id = ${dadId}::uuid`;
for (let i = 0; i < 3; i++) {
  await ai`
    DELETE FROM biomarker_readings
    WHERE profile_id = ${dadId}::uuid
      AND id NOT IN (SELECT supersedes_id FROM biomarker_readings WHERE supersedes_id IS NOT NULL)
  `;
}
await ai`DELETE FROM reference_ranges WHERE id IN ${ai(rangeIds)}`;
if (reportId) await ai`DELETE FROM documents WHERE id = ${reportId}::uuid`;
if (dadId)
  await fetch(`${USER_PROVIDER}/profiles/${dadId}`, { method: 'DELETE', headers: authHeaders });
await core.end();
await ai.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
