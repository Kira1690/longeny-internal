/**
 * End-to-end tests for the trend API (Week 8, V-W8-4).
 *
 * Real services, real PostgreSQL — no mocks. Readings go in through the
 * readings API, so this covers report → readings → trend in one pass.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/trends.e2e.ts
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
const A1C = `tr${RUN}_a1c`;
const HDL = `tr${RUN}_hdl`;
const FREE = `tr${RUN}_free`;

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: `w8tr-${RUN}@longeny.test`,
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
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w8tr-o-${RUN}@longeny.test` })}`,
  ...json,
};
const providerHeaders = {
  Authorization: `Bearer ${mintToken({
    sub: PROVIDER_AUTH_ID,
    email: `w8tr-doc-${RUN}@longeny.test`,
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
    VALUES (${authId}::uuid, ${`w8tr-${label}-${RUN}@longeny.test`}, ${`W8${label}`}, 'Trends')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

let r = await call(await fetch(`${USER_PROVIDER}/profiles`, { headers: authHeaders }));
const selfId: string = r.body.data?.find((p: any) => p.is_self)?.id;
check('the account’s own profile resolves', Boolean(selfId), r);

const [rangeRow] = await ai`
  INSERT INTO reference_ranges
    (marker_code, marker_name, unit, normal_low, normal_high, optimal_low, optimal_high, source)
  VALUES (${A1C}, 'HbA1c', '%', 4, 5.6, 4.5, 5.2, ${`e2e ${RUN}`})
  RETURNING id
`;
const [hdlRow] = await ai`
  INSERT INTO reference_ranges
    (marker_code, marker_name, unit, normal_low, optimal_low, source)
  VALUES (${HDL}, 'HDL', 'mg/dL', 40, 60, ${`e2e ${RUN}`})
  RETURNING id
`;

const docs: string[] = [];
async function panel(day: string, readings: unknown[]) {
  const up = await post(
    `${BASE}/documents/upload`,
    {
      title: `Panel ${day} ${RUN}`,
      fileName: `panel-${day}.pdf`,
      fileSize: 2048,
      mimeType: 'application/pdf',
      documentType: 'lab_report',
      reportedAt: `${day}T08:00:00.000Z`,
    },
    { ...authHeaders, 'X-Active-Profile-Id': selfId },
  );
  const id = up.body.data?.documentId as string;
  docs.push(id);
  const res = await post(`${BASE}/reports/${id}/readings`, { readings });
  return { id, readings: res.body.data as any[], status: res.status };
}

// Three panels, entered out of date order.
const march = await panel('2026-03-01', [
  { markerCode: A1C, value: 6.4, unit: '%' },
  { markerCode: HDL, value: 38, unit: 'mg/dL' },
  { markerCode: FREE, value: 10, unit: 'u' },
]);
const july = await panel('2026-07-01', [
  { markerCode: A1C, value: 5.7, unit: '%' },
  { markerCode: HDL, value: 52, unit: 'mg/dL' },
]);
const may = await panel('2026-05-01', [
  { markerCode: A1C, value: 6.0, unit: '%' },
  { markerCode: HDL, value: 30, unit: 'mmol/L' },
  { markerCode: FREE, value: 12, unit: 'u' },
]);
check(
  'three panels entered through the readings API',
  [march, may, july].every((p) => p.status === 201),
  [march.status, may.status, july.status],
);

// A typo in July, corrected. The trend must use the correction.
const julyA1c = july.readings.find((x) => x.marker_code === A1C);
const fix = await post(`${BASE}/readings/${julyA1c?.id}/corrections`, { value: 5.5, unit: '%' });
check('the July HbA1c is corrected', fix.status === 201, fix);

// ── 1. The trend ─────────────────────────────────────────────────────────────

console.log('\n1. GET /profiles/:id/trends');

r = await get(`${BASE}/profiles/${selfId}/trends`);
check('200 OK', r.status === 200, r);
const trends: any[] = r.body.data ?? [];
const a1c = trends.find((t) => t.marker_code === A1C);
const hdl = trends.find((t) => t.marker_code === HDL);
const free = trends.find((t) => t.marker_code === FREE);

check(
  'one trend per marker',
  trends.length === 3,
  trends.map((t) => t.marker_code),
);
check(
  'points are in sample order, not entry order',
  JSON.stringify(a1c?.points.map((p: any) => p.value)) === JSON.stringify([6.4, 6.0, 5.5]),
  a1c?.points,
);
check(
  'the correction replaced the typo in the series',
  a1c?.points[2]?.reading_id === fix.body.data?.id,
  a1c?.points,
);
check('HbA1c is falling', a1c?.direction === 'falling', a1c);
check('and falling towards the band is improving', a1c?.toward_range === 'improving', a1c);
check('change is latest minus previous', a1c?.change === -0.5, a1c);
check('each point carries its own verdict', a1c?.points[0]?.status === 'high', a1c?.points);
check('judged against a placeholder → provisional', a1c?.provisional === true, a1c);
check('the range names its source', a1c?.range?.source === `e2e ${RUN}`, a1c?.range);

check(
  'HDL: the mmol/L sample is left out, not converted',
  hdl?.excluded_for_unit === 1 && hdl?.points.length === 2,
  hdl,
);
check('HDL rising towards its floor is improving', hdl?.toward_range === 'improving', hdl);

check('a marker with no range has a direction', free?.direction === 'rising', free);
check('but no judgement', free?.toward_range === null && free?.range === null, free);
check('meta flags provisional', r.body.meta?.provisional === true, r.body.meta);

r = await get(`${BASE}/profiles/${selfId}/trends?marker=${A1C}`);
check(
  '?marker= narrows to one marker',
  r.status === 200 && r.body.data?.length === 1 && r.body.data[0].marker_code === A1C,
  r.body.data?.map((t: any) => t.marker_code),
);

r = await get(`${BASE}/profiles/${selfId}/trends?marker=HbA1c%25`);
check('a malformed marker → 400', r.status === 400, r);

await ai`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = ${july.id}::uuid`;
r = await get(`${BASE}/profiles/${selfId}/trends?marker=${A1C}`);
check(
  'deleting a report takes its values out of the trend',
  JSON.stringify(r.body.data?.[0]?.points.map((p: any) => p.value)) === JSON.stringify([6.4, 6.0]),
  r.body.data?.[0]?.points,
);

// ── 2. Access ────────────────────────────────────────────────────────────────

console.log('\n2. Access');

r = await get(`${BASE}/profiles/${selfId}/trends`, otherHeaders);
check('another account → 404', r.status === 404, r);
r = await get(`${BASE}/profiles/${selfId}/trends`, providerHeaders);
check('a provider with no booking → 404', r.status === 404, r);
r = await call(await fetch(`${BASE}/profiles/${selfId}/trends`));
check('no token → 401', r.status === 401, r);
r = await get(`${BASE}/profiles/not-a-uuid/trends`);
check('a malformed profile id → 400', r.status === 400, r);

try {
  await fetch(`${GATEWAY}/health`);
  r = await get(`${GATEWAY}/api/v1/profiles/${selfId}/trends`);
  check(
    'the gateway routes it to ai-content',
    r.status === 200 && r.body.data?.length === 3,
    r.status,
  );
} catch {
  check('gateway reachable', false, `${GATEWAY} not running`);
}

// ── Teardown ─────────────────────────────────────────────────────────────────

for (let i = 0; i < 4; i++) {
  await ai`
    DELETE FROM biomarker_readings
    WHERE profile_id = ${selfId}::uuid
      AND id NOT IN (SELECT supersedes_id FROM biomarker_readings WHERE supersedes_id IS NOT NULL)
  `;
}
await ai`DELETE FROM reference_ranges WHERE id IN (${rangeRow.id}::uuid, ${hdlRow.id}::uuid)`;
if (docs.length > 0) await ai`DELETE FROM documents WHERE id IN ${ai(docs)}`;
await core.end();
await ai.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
