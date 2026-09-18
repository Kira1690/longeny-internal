/**
 * End-to-end tests for entering and correcting report readings (Week 8, V-W8-2).
 *
 * Real services, real PostgreSQL — no mocks. Requires user-provider-service on
 * :3002, booking-service on :3003, ai-content-service on :3004 and the gateway
 * on :3000.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/readings.e2e.ts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const BOOKING = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3003';
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

const M = (name: string) => `r${RUN}_${name}`;

const USER_PERMISSIONS = [
  'profiles:read',
  'profiles:write',
  'documents:read',
  'documents:write',
  'bookings:read',
  'bookings:write',
];

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: `w8rd-${RUN}@longeny.test`,
      role: 'user',
      roles: ['user'],
      permissions: USER_PERMISSIONS,
      jti: crypto.randomUUID(),
      ...claims,
    },
    JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const json = { 'Content-Type': 'application/json' };
const authHeaders = { Authorization: `Bearer ${mintToken()}`, ...json };
const otherAccountHeaders = {
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w8rd-other-${RUN}@longeny.test` })}`,
  ...json,
};
const readOnlyHeaders = {
  Authorization: `Bearer ${mintToken({ permissions: ['profiles:read', 'documents:read'] })}`,
  ...json,
};
const providerHeaders = {
  Authorization: `Bearer ${mintToken({
    sub: PROVIDER_AUTH_ID,
    email: `w8rd-doc-${RUN}@longeny.test`,
    role: 'provider',
    roles: ['provider'],
    // Even holding documents:write, a provider cannot enter a patient's values.
    permissions: ['documents:read', 'documents:write', 'profiles:read', 'bookings:read'],
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

// ── Preflight ────────────────────────────────────────────────────────────────

for (const [name, url] of [
  ['ai-content', `${BASE}/health`],
  ['user-provider', `${USER_PROVIDER}/health`],
  ['booking', `${BOOKING}/health`],
] as const) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`returned ${res.status}`);
  } catch (err) {
    console.error(`${name} not reachable at ${url} — start it first.\n  ${err}`);
    process.exit(1);
  }
}

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);
const bookingDb = postgres(process.env.BOOKING_DATABASE_URL as string);

for (const [authId, label] of [
  [AUTH_ID, 'own'],
  [OTHER_AUTH_ID, 'other'],
] as const) {
  await core`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (${authId}::uuid, ${`w8rd-${label}-${RUN}@longeny.test`}, ${`W8${label}`}, 'Readings')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

let r = await post(`${USER_PROVIDER}/profiles`, { relation: 'mother', firstName: `Mum-${RUN}` });
const mumId: string = r.body.data?.id;
check('fixture profile created', r.status === 201 && Boolean(mumId), r);

const REPORT_DATE = '2026-08-20T07:45:00.000Z';

async function upload(title: string, documentType = 'lab_report') {
  const res = await post(
    `${BASE}/documents/upload`,
    {
      title,
      fileName: `${title.replace(/\s+/g, '-')}.pdf`,
      fileSize: 2048,
      mimeType: 'application/pdf',
      documentType,
      reportedAt: REPORT_DATE,
    },
    { ...authHeaders, 'X-Active-Profile-Id': mumId },
  );
  return res.body.data?.documentId as string;
}

const labId = await upload(`Panel ${RUN}`);
const rxId = await upload(`Prescription ${RUN}`, 'prescription');
const goneId = await upload(`Withdrawn ${RUN}`);
check('fixture reports uploaded', Boolean(labId && rxId && goneId));
await ai`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = ${goneId}::uuid`;

const countFor = async (documentId: string) =>
  Number(
    (
      await ai`SELECT count(*)::int AS n FROM biomarker_readings WHERE document_id = ${documentId}::uuid`
    )[0].n,
  );

// ── 1. Entering a panel ──────────────────────────────────────────────────────

console.log('\n1. POST /reports/:id/readings');

r = await post(`${BASE}/reports/${labId}/readings`, {
  readings: [
    { markerCode: M('a1c'), value: 5.4, unit: '%' },
    { markerCode: M('ldl'), value: 118, unit: 'mg/dL', measuredAt: '2026-08-19T06:00:00Z' },
    { markerCode: M('vitd'), value: 0.0001, unit: 'ng/mL' },
  ],
});
check('201 Created', r.status === 201, r);
const entered: any[] = r.body.data ?? [];
const a1c = entered.find((x) => x.marker_code === M('a1c'));
const ldl = entered.find((x) => x.marker_code === M('ldl'));
check('three readings back', entered.length === 3, entered);
check(
  'filed against the report’s profile',
  entered.every((x) => x.profile_id === mumId),
  entered,
);
check('value comes back as a number', a1c?.value === 5.4, a1c);
check(
  'four decimal places survive the round trip',
  entered.some((x) => x.value === 0.0001),
);
check('sample date defaults to the report date, not today', a1c?.measured_at === REPORT_DATE, a1c);
check('an explicit sample date is kept', ldl?.measured_at === '2026-08-19T06:00:00.000Z', ldl);
check(
  'entered by hand',
  entered.every((x) => x.entry_method === 'manual'),
);

const [stored] = await ai`
  SELECT entered_by_auth_id, profile_id FROM biomarker_readings WHERE id = ${a1c?.id}::uuid
`;
check('the database records who entered it', stored?.entered_by_auth_id === AUTH_ID, stored);
check('but the response does not echo the account id', !JSON.stringify(entered).includes(AUTH_ID));

// ── 2. What is refused ───────────────────────────────────────────────────────

console.log('\n2. A bad submission stores nothing');

const before = await countFor(labId);
const refusals: Array<[string, unknown]> = [
  [
    'the same marker twice',
    {
      readings: [
        { markerCode: M('dup'), value: 1, unit: 'x' },
        { markerCode: M('dup'), value: 2, unit: 'x' },
      ],
    },
  ],
  ['no readings at all', { readings: [] }],
  [
    'a marker code that is not a code',
    { readings: [{ markerCode: 'HbA1c %', value: 1, unit: '%' }] },
  ],
  ['a missing unit', { readings: [{ markerCode: M('nounit'), value: 1 }] }],
  ['a blank unit', { readings: [{ markerCode: M('blank'), value: 1, unit: '   ' }] }],
  ['five decimal places', { readings: [{ markerCode: M('prec'), value: 1.00001, unit: 'x' }] }],
  [
    'a value too large for the column',
    { readings: [{ markerCode: M('big'), value: 1e9, unit: 'x' }] },
  ],
  ['a value sent as a string', { readings: [{ markerCode: M('str'), value: '5.4', unit: '%' }] }],
  [
    'a profile id in the body — the subject comes from the report',
    { profileId: crypto.randomUUID(), readings: [{ markerCode: M('pid'), value: 1, unit: 'x' }] },
  ],
  [
    'an unknown key on a reading',
    { readings: [{ markerCode: M('key'), value: 1, unit: 'x', entryMethod: 'extracted' }] },
  ],
  [
    'a bad sample date',
    { readings: [{ markerCode: M('date'), value: 1, unit: 'x', measuredAt: 'yesterday' }] },
  ],
];
for (const [label, body] of refusals) {
  r = await post(`${BASE}/reports/${labId}/readings`, body);
  check(`400 — ${label}`, r.status === 400, r.status === 400 ? undefined : r);
}
check('and nothing was stored by any of them', (await countFor(labId)) === before);

r = await post(`${BASE}/reports/${rxId}/readings`, {
  readings: [{ markerCode: M('rx'), value: 1, unit: 'x' }],
});
check('a prescription does not take readings — 400', r.status === 400, r);
check('nothing stored against it', (await countFor(rxId)) === 0);

r = await post(`${BASE}/reports/${goneId}/readings`, {
  readings: [{ markerCode: M('gone'), value: 1, unit: 'x' }],
});
check('a deleted report → 404', r.status === 404, r);

r = await post(`${BASE}/reports/${crypto.randomUUID()}/readings`, {
  readings: [{ markerCode: M('nope'), value: 1, unit: 'x' }],
});
check('a report that never existed → 404', r.status === 404, r);

r = await post(`${BASE}/reports/not-a-uuid/readings`, {
  readings: [{ markerCode: M('uuid'), value: 1, unit: 'x' }],
});
check('a malformed report id → 400', r.status === 400, r);

// ── 3. Who may write ─────────────────────────────────────────────────────────

console.log('\n3. Only the family enters values');

const oneReading = { readings: [{ markerCode: M('who'), value: 1, unit: 'x' }] };

r = await post(`${BASE}/reports/${labId}/readings`, oneReading, otherAccountHeaders);
check('another account → 404, never 403', r.status === 404, r);

r = await post(`${BASE}/reports/${labId}/readings`, oneReading, readOnlyHeaders);
check('no documents:write → 403', r.status === 403, r);

r = await call(
  await fetch(`${BASE}/reports/${labId}/readings`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(oneReading),
  }),
);
check('no token → 401', r.status === 401, r);

r = await post(
  `${BOOKING}/bookings`,
  {
    providerId: PROVIDER_AUTH_ID,
    sessionType: 'consultation',
    startTime: new Date(Date.now() + 86_400_000).toISOString(),
    endTime: new Date(Date.now() + 90_000_000).toISOString(),
    timezone: 'Asia/Kolkata',
  },
  { ...authHeaders, 'X-Active-Profile-Id': mumId },
);
const bookingId: string = r.body.data?.id;
check('the family books a provider', r.status === 201, r);

r = await post(`${BASE}/reports/${labId}/readings`, oneReading, providerHeaders);
check('a booked provider still cannot enter values — 404', r.status === 404, r);
check('nothing from the refused writers was stored', (await countFor(labId)) === before);

// ── 4. Reading them back ─────────────────────────────────────────────────────

console.log('\n4. GET /reports/:id/readings');

r = await get(`${BASE}/reports/${labId}/readings`);
check('200 OK', r.status === 200, r);
check('the three readings', (r.body.data ?? []).length === 3, r.body.data);

r = await get(`${BASE}/reports/${labId}/readings`, providerHeaders);
check('a booked provider can read them', r.status === 200 && r.body.data?.length === 3, r);

r = await get(`${BASE}/reports/${labId}/readings`, otherAccountHeaders);
check('another account → 404', r.status === 404, r);

r = await get(`${BASE}/reports/${goneId}/readings`);
check('a deleted report → 404', r.status === 404, r);

// ── 5. Corrections ───────────────────────────────────────────────────────────

console.log('\n5. POST /readings/:id/corrections');

r = await post(`${BASE}/readings/${a1c?.id}/corrections`, { value: 5.9, unit: '%' });
check('201 Created', r.status === 201, r);
const fix = r.body.data;
check('it names the reading it corrects', fix?.supersedes_id === a1c?.id, fix);
check('same marker', fix?.marker_code === M('a1c'), fix);
check('same sample date unless told otherwise', fix?.measured_at === REPORT_DATE, fix);
check('the new value', fix?.value === 5.9, fix);

r = await get(`${BASE}/reports/${labId}/readings`);
const history = (r.body.data ?? []).filter((x: any) => x.marker_code === M('a1c'));
const original = history.find((x: any) => x.id === a1c?.id);
check('the original is kept', Boolean(original), history);
check('and marked no longer current', original?.current === false, original);
check('pointing at its replacement', original?.superseded_by === fix?.id, original);
check(
  'exactly one current value for the marker',
  history.filter((x: any) => x.current).length === 1,
  history,
);

r = await post(`${BASE}/readings/${a1c?.id}/corrections`, { value: 6.0, unit: '%' });
check('correcting the replaced reading again → 409', r.status === 409, r);
check('with a code that says why', r.body.error?.code === 'READING_SUPERSEDED', r.body);

r = await post(`${BASE}/readings/${fix?.id}/corrections`, { value: 5.8, unit: '%' });
check('correcting the correction is how you fix it twice — 201', r.status === 201, r);
const fix2 = r.body.data;

r = await post(`${BASE}/readings/${fix2?.id}/corrections`, {
  value: 5.7,
  unit: '%',
  markerCode: 'x',
});
check('a correction cannot change the marker — 400', r.status === 400, r);

r = await post(
  `${BASE}/readings/${fix2?.id}/corrections`,
  { value: 5.7, unit: '%' },
  otherAccountHeaders,
);
check('another account → 404', r.status === 404, r);

r = await post(
  `${BASE}/readings/${fix2?.id}/corrections`,
  { value: 5.7, unit: '%' },
  providerHeaders,
);
check('a booked provider → 404', r.status === 404, r);

r = await post(`${BASE}/readings/${crypto.randomUUID()}/corrections`, { value: 1, unit: 'x' });
check('a reading that does not exist → 404', r.status === 404, r);

// Two corrections at once: the constraint decides, and exactly one wins.
const race = await Promise.all([
  post(`${BASE}/readings/${ldl?.id}/corrections`, { value: 120, unit: 'mg/dL' }),
  post(`${BASE}/readings/${ldl?.id}/corrections`, { value: 121, unit: 'mg/dL' }),
]);
const statuses = race.map((x) => x.status).sort();
check('two racing corrections: one 201, one 409', statuses.join(',') === '201,409', statuses);

// ── 6. What the benchmark sees ───────────────────────────────────────────────

console.log('\n6. Benchmarks read the current value');

r = await get(`${BASE}/profiles/${mumId}/benchmarks`);
check('200 OK', r.status === 200, r);
const bmA1c = (r.body.data ?? []).find((b: any) => b.marker_code === M('a1c'));
check('the latest correction is what gets judged', bmA1c?.reading?.id === fix2?.id, bmA1c);
check(
  'and a marker with no range is no_reference',
  bmA1c?.status === 'no_reference' && bmA1c?.reason === 'no_range_for_marker',
  bmA1c,
);

// ── 7. Through the gateway ───────────────────────────────────────────────────

console.log('\n7. Through the gateway');

try {
  await fetch(`${GATEWAY}/health`);
  r = await get(`${GATEWAY}/api/v1/reports/${labId}/readings`);
  check('/api/v1/reports/:id/readings reaches ai-content', r.status === 200, r.status);
  r = await post(`${GATEWAY}/api/v1/readings/${fix2?.id}/corrections`, { value: 5.6, unit: '%' });
  check('/api/v1/readings/:id/corrections reaches ai-content', r.status === 201, r);
} catch {
  check('gateway reachable', false, `${GATEWAY} not running`);
}

// ── 8. Audit ─────────────────────────────────────────────────────────────────

console.log('\n8. Writes, reads and refusals are recorded');

const audit = await ai`
  SELECT action, actor_id, success, method AS http_method FROM phi_access_log
  WHERE action = 'readings.access' AND (actor_id IN (${AUTH_ID}, ${OTHER_AUTH_ID}, ${PROVIDER_AUTH_ID}))
`;
check(
  'reading writes are logged',
  audit.some((x: any) => x.http_method === 'POST' && x.success),
);
check(
  'reading reads are logged',
  audit.some((x: any) => x.http_method === 'GET' && x.success),
);
check(
  'the other account’s refusal is logged against that account',
  audit.some((x: any) => x.actor_id === OTHER_AUTH_ID && !x.success),
);
check(
  'the provider’s refused write is logged',
  audit.some((x: any) => x.actor_id === PROVIDER_AUTH_ID && x.http_method === 'POST' && !x.success),
);

// ── Teardown ─────────────────────────────────────────────────────────────────

// Leaves first: a row is deleted only once nothing corrects it any more.
for (let i = 0; i < 5; i++) {
  await ai`
    DELETE FROM biomarker_readings
    WHERE profile_id = ${mumId}::uuid
      AND id NOT IN (SELECT supersedes_id FROM biomarker_readings WHERE supersedes_id IS NOT NULL)
  `;
}
await ai`DELETE FROM documents WHERE id IN (${labId}::uuid, ${rxId}::uuid, ${goneId}::uuid)`;
if (bookingId) await bookingDb`DELETE FROM bookings WHERE id = ${bookingId}::uuid`;
if (mumId)
  await fetch(`${USER_PROVIDER}/profiles/${mumId}`, { method: 'DELETE', headers: authHeaders });
await core.end();
await ai.end();
await bookingDb.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
