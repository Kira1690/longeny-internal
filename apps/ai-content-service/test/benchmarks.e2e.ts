/**
 * End-to-end tests for readings, reference ranges and benchmarks (Week 8,
 * V-W8-1 and V-W8-3).
 *
 * Real services, real PostgreSQL — no mocks. Requires user-provider-service on
 * :3002, booking-service on :3003, ai-content-service on :3004 and the gateway
 * on :3000.
 *
 * Readings are written straight to the database here: the entry API is V-W8-2
 * and is not built yet. Everything read back goes through the HTTP API.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/benchmarks.e2e.ts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const BOOKING = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3003';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();
const OTHER_AUTH_ID = crypto.randomUUID();
const PROVIDER_AUTH_ID = crypto.randomUUID();
const UNBOOKED_PROVIDER_ID = crypto.randomUUID();

// Marker codes unique to this run, so a dev database with other ranges in it
// cannot change what this suite sees.
const M = (name: string) => `t${RUN}_${name}`;
const MARKERS = {
  optimal: M('optimal'),
  high: M('high'),
  low: M('low'),
  unit: M('unit'),
  none: M('none'),
  maleOnly: M('male_only'),
  corrected: M('corrected'),
  latest: M('latest'),
  deletedDoc: M('deleted_doc'),
  reviewed: M('reviewed'),
  retired: M('retired'),
};

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
      email: `w8bm-${RUN}@longeny.test`,
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
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w8bm-other-${RUN}@longeny.test` })}`,
  ...json,
};
const noDocumentsPermission = {
  Authorization: `Bearer ${mintToken({ permissions: ['profiles:read'] })}`,
  ...json,
};
const providerToken = (sub: string) => ({
  Authorization: `Bearer ${mintToken({
    sub,
    email: `w8bm-doc-${sub.slice(0, 6)}@longeny.test`,
    role: 'provider',
    roles: ['provider'],
    permissions: ['documents:read', 'profiles:read', 'bookings:read'],
  })}`,
  ...json,
});
const providerHeaders = providerToken(PROVIDER_AUTH_ID);
const unbookedProviderHeaders = providerToken(UNBOOKED_PROVIDER_ID);

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

/** Runs a statement that must be refused by the database, and says whether it was. */
async function rejected(run: () => Promise<unknown>, constraint: string) {
  try {
    await run();
    return { ok: false, detail: 'accepted' };
  } catch (err) {
    const message = String((err as Error).message);
    return { ok: message.includes(constraint), detail: message };
  }
}

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
    VALUES (${authId}::uuid, ${`w8bm-${label}-${RUN}@longeny.test`}, ${`W8${label}`}, 'Bench')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

let r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'father', firstName: `Dad-${RUN}` }),
  }),
);
const dadId: string = r.body.data?.id;
check('fixture profile created', r.status === 201 && Boolean(dadId), r);

async function uploadReport(title: string) {
  const res = await call(
    await fetch(`${BASE}/documents/upload`, {
      method: 'POST',
      headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
      body: JSON.stringify({
        title,
        fileName: `${title.replace(/\s+/g, '-')}.pdf`,
        fileSize: 2048,
        mimeType: 'application/pdf',
        documentType: 'lab_report',
        reportedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      }),
    }),
  );
  return res.body.data?.documentId as string;
}

const reportId = await uploadReport(`Bloods ${RUN}`);
const deletedReportId = await uploadReport(`Withdrawn ${RUN}`);
check('two fixture reports uploaded', Boolean(reportId && deletedReportId));

const createdRangeIds: string[] = [];
async function addRange(values: Record<string, unknown>) {
  const row = {
    marker_name: 'Test marker',
    unit: 'mg/dL',
    sex: 'any',
    normal_low: 70,
    normal_high: 100,
    optimal_low: 80,
    optimal_high: 90,
    source: `e2e ${RUN}`,
    ...values,
  };
  const [inserted] = await ai`INSERT INTO reference_ranges ${ai(row)} RETURNING id`;
  createdRangeIds.push(inserted.id);
  return inserted.id as string;
}

const readingIds: string[] = [];
async function addReading(values: Record<string, unknown>) {
  const row = {
    profile_id: dadId,
    document_id: reportId,
    unit: 'mg/dL',
    measured_at: new Date(Date.now() - 7 * 86_400_000),
    entry_method: 'manual',
    entered_by_auth_id: AUTH_ID,
    ...values,
  };
  const [inserted] = await ai`INSERT INTO biomarker_readings ${ai(row)} RETURNING id`;
  readingIds.push(inserted.id);
  return inserted.id as string;
}

// ── 1. The schema holds its own rules ────────────────────────────────────────

console.log('\n1. The database refuses a range or reading that cannot be right');

let res = await rejected(
  () => addRange({ marker_code: M('nobound'), normal_low: null, normal_high: null }),
  'reference_range_has_a_bound',
);
check('a range with no bound at all', res.ok, res.detail);

res = await rejected(
  () => addRange({ marker_code: M('inverted'), normal_low: 100, normal_high: 70 }),
  'reference_range_normal_ordered',
);
check('a normal band upside down', res.ok, res.detail);

res = await rejected(
  () => addRange({ marker_code: M('wide_opt'), optimal_low: 60 }),
  'reference_range_optimal_inside_normal',
);
check('an optimal band reaching outside the normal band', res.ok, res.detail);

res = await rejected(
  () => addRange({ marker_code: 'HbA1c %' }),
  'reference_range_marker_code_format',
);
check('a marker code that is not a lower-case code', res.ok, res.detail);

res = await rejected(
  () => addRange({ marker_code: M('nosource'), source: '   ' }),
  'reference_range_source_named',
);
check('a range that does not say where it came from', res.ok, res.detail);

res = await rejected(
  () => addReading({ marker_code: M('orphan'), value: 1, document_id: crypto.randomUUID() }),
  'biomarker_readings_document_id_documents_id_fk',
);
check('a reading with no report behind it', res.ok, res.detail);

const defaultRangeId = await addRange({ marker_code: MARKERS.optimal });
const [defaultRow] =
  await ai`SELECT is_placeholder FROM reference_ranges WHERE id = ${defaultRangeId}::uuid`;
check(
  'a range not marked either way is a placeholder — real has to be said out loud',
  defaultRow?.is_placeholder === true,
  defaultRow,
);

// ── 2. Fixture readings, one per rule ────────────────────────────────────────

await addRange({ marker_code: MARKERS.high });
await addRange({ marker_code: MARKERS.low });
await addRange({ marker_code: MARKERS.unit, unit: 'mmol/L' });
await addRange({ marker_code: MARKERS.maleOnly, sex: 'male' });
await addRange({ marker_code: MARKERS.corrected });
await addRange({ marker_code: MARKERS.latest });
await addRange({ marker_code: MARKERS.deletedDoc });
await addRange({ marker_code: MARKERS.reviewed, is_placeholder: false, source: `Reviewed ${RUN}` });
const retiredRangeId = await addRange({
  marker_code: MARKERS.retired,
  retired_at: new Date(),
});

await addReading({ marker_code: MARKERS.optimal, value: 85 });
await addReading({ marker_code: MARKERS.high, value: 140 });
await addReading({ marker_code: MARKERS.low, value: 50 });
await addReading({ marker_code: MARKERS.unit, value: 5.1 });
await addReading({ marker_code: MARKERS.none, value: 12 });
await addReading({ marker_code: MARKERS.maleOnly, value: 85 });
await addReading({ marker_code: MARKERS.reviewed, value: 95 });
await addReading({ marker_code: MARKERS.retired, value: 85 });

// A typo, then its correction. The correction is what counts.
const typoId = await addReading({ marker_code: MARKERS.corrected, value: 850 });
const fixId = await addReading({
  marker_code: MARKERS.corrected,
  value: 85,
  supersedes_id: typoId,
});

// Entered newest-first, so entry order and sample order disagree.
const newerSampleId = await addReading({
  marker_code: MARKERS.latest,
  value: 95,
  measured_at: new Date(Date.now() - 2 * 86_400_000),
});
await addReading({
  marker_code: MARKERS.latest,
  value: 150,
  measured_at: new Date(Date.now() - 30 * 86_400_000),
});

await addReading({ marker_code: MARKERS.deletedDoc, value: 85, document_id: deletedReportId });
await ai`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = ${deletedReportId}::uuid`;

res = await rejected(
  () => addReading({ marker_code: MARKERS.corrected, value: 86, supersedes_id: typoId }),
  'biomarker_reading_supersedes_unique',
);
check('a reading can only be corrected once — correct the correction instead', res.ok, res.detail);

// ── 3. The benchmarks ────────────────────────────────────────────────────────

console.log('\n2. GET /profiles/:id/benchmarks');

r = await call(await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: authHeaders }));
check('200 OK', r.status === 200, r);
const list: any[] = r.body.data ?? [];
const by = (code: string) => list.find((b) => b.marker_code === code);

check('inside optimal → optimal', by(MARKERS.optimal)?.status === 'optimal', by(MARKERS.optimal));
check('above the normal band → high', by(MARKERS.high)?.status === 'high', by(MARKERS.high));
check('below the normal band → low', by(MARKERS.low)?.status === 'low', by(MARKERS.low));
check(
  'different units → unit_mismatch, and the value is not converted',
  by(MARKERS.unit)?.status === 'unit_mismatch' && by(MARKERS.unit)?.reading?.value === 5.1,
  by(MARKERS.unit),
);
check(
  'no range for the marker → no_reference, never a guess',
  by(MARKERS.none)?.status === 'no_reference' &&
    by(MARKERS.none)?.reason === 'no_range_for_marker' &&
    by(MARKERS.none)?.range === null,
  by(MARKERS.none),
);
check(
  'only a male range, sex unknown → needs_demographics, not the male range',
  by(MARKERS.maleOnly)?.status === 'no_reference' &&
    by(MARKERS.maleOnly)?.reason === 'needs_demographics',
  by(MARKERS.maleOnly),
);
check(
  'a retired range is not used',
  by(MARKERS.retired)?.status === 'no_reference' && by(MARKERS.retired)?.range === null,
  by(MARKERS.retired),
);
check(
  'a corrected value replaces the typo',
  by(MARKERS.corrected)?.reading?.id === fixId && by(MARKERS.corrected)?.status === 'optimal',
  by(MARKERS.corrected),
);
check(
  'the newest sample wins, not the newest entry',
  by(MARKERS.latest)?.reading?.id === newerSampleId,
  by(MARKERS.latest),
);
check(
  'a reading from a deleted report is gone',
  by(MARKERS.deletedDoc) === undefined,
  by(MARKERS.deletedDoc),
);
check(
  'one entry per marker',
  list.length === new Set(list.map((b) => b.marker_code)).size,
  list.map((b) => b.marker_code),
);
check(
  'every reading names the report it came from',
  list.every((b) => b.reading?.document_id === reportId),
  list.map((b) => b.reading?.document_id),
);
check(
  'a range names its source',
  by(MARKERS.high)?.range?.source === `e2e ${RUN}`,
  by(MARKERS.high)?.range,
);
check(
  'placeholder range → provisional verdict',
  by(MARKERS.high)?.provisional === true && by(MARKERS.high)?.range?.provisional === true,
  by(MARKERS.high),
);
check(
  'reviewed range → not provisional',
  by(MARKERS.reviewed)?.provisional === false && by(MARKERS.reviewed)?.status === 'normal',
  by(MARKERS.reviewed),
);
check(
  'meta says the page holds provisional verdicts',
  r.body.meta?.provisional === true,
  r.body.meta,
);
check(
  'meta says demographics are unavailable',
  r.body.meta?.demographics === 'unavailable',
  r.body.meta,
);
check(
  'numbers come back as numbers, not strings',
  typeof by(MARKERS.high)?.reading?.value === 'number' &&
    typeof by(MARKERS.high)?.range?.normal_high === 'number',
  by(MARKERS.high),
);

const again = await call(
  await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: authHeaders }),
);
const strip = (rows: any[]) => JSON.stringify(rows);
check(
  'recomputing from stored readings gives the identical answer',
  again.status === 200 && strip(again.body.data) === strip(list),
);

// ── 4. Who may read them ─────────────────────────────────────────────────────

console.log('\n3. Only the family, or a provider they booked');

r = await call(
  await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: otherAccountHeaders }),
);
check('another account → 404, never 403', r.status === 404, r);

r = await call(await fetch(`${BASE}/profiles/${dadId}/benchmarks`));
check('no token → 401', r.status === 401, r);

r = await call(
  await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: noDocumentsPermission }),
);
check('no documents:read → 403', r.status === 403, r);

r = await call(await fetch(`${BASE}/profiles/not-a-uuid/benchmarks`, { headers: authHeaders }));
check('malformed profile id → 400', r.status === 400, r);

r = await call(await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: providerHeaders }));
check('a provider with no booking → 404, same as a stranger', r.status === 404, r);

r = await call(
  await fetch(`${BOOKING}/bookings`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
    body: JSON.stringify({
      providerId: PROVIDER_AUTH_ID,
      sessionType: 'consultation',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
      timezone: 'Asia/Kolkata',
    }),
  }),
);
const bookingId: string = r.body.data?.id;
check('the family books that provider', r.status === 201, r);

r = await call(await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: providerHeaders }));
check('now the provider reads the benchmarks', r.status === 200, r);
check('and sees the same verdicts', strip(r.body.data ?? []) === strip(list));

r = await call(
  await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: unbookedProviderHeaders }),
);
check('a different provider still cannot', r.status === 404, r);

await bookingDb`UPDATE bookings SET status = 'cancelled' WHERE id = ${bookingId}::uuid`;
r = await call(await fetch(`${BASE}/profiles/${dadId}/benchmarks`, { headers: providerHeaders }));
check('cancelling the booking closes the access again', r.status === 404, r);

// ── 5. The reference ranges ──────────────────────────────────────────────────

console.log('\n4. GET /reference-ranges');

r = await call(
  await fetch(`${BASE}/reference-ranges?marker=${MARKERS.high}`, { headers: authHeaders }),
);
check('200 OK', r.status === 200, r);
check('one range for the marker', (r.body.data ?? []).length === 1, r.body.data);
check('it is marked provisional', r.body.data?.[0]?.provisional === true, r.body.data);
check('and meta says so', r.body.meta?.provisional === true, r.body.meta);

r = await call(
  await fetch(`${BASE}/reference-ranges?marker=${MARKERS.retired}`, { headers: authHeaders }),
);
check(
  'a retired range is not listed',
  r.status === 200 && (r.body.data ?? []).length === 0,
  r.body.data,
);
const [retiredStillThere] =
  await ai`SELECT id FROM reference_ranges WHERE id = ${retiredRangeId}::uuid`;
check('but it is kept, not deleted', Boolean(retiredStillThere));

r = await call(
  await fetch(`${BASE}/reference-ranges?marker=HbA1c%20%25`, { headers: authHeaders }),
);
check('an invalid marker code → 400', r.status === 400, r);

r = await call(await fetch(`${BASE}/reference-ranges`));
check('no token → 401', r.status === 401, r);

r = await call(await fetch(`${BASE}/reference-ranges`, { headers: noDocumentsPermission }));
check('no documents:read → 403', r.status === 403, r);

// ── 6. Through the gateway ───────────────────────────────────────────────────

console.log('\n5. The gateway routes both to ai-content');

let gatewayUp = false;
try {
  gatewayUp = (await fetch(`${GATEWAY}/health`)).status < 600;
} catch {
  gatewayUp = false;
}
if (!gatewayUp) {
  check('gateway reachable', false, `${GATEWAY} not running`);
} else {
  r = await call(
    await fetch(`${GATEWAY}/api/v1/profiles/${dadId}/benchmarks`, { headers: authHeaders }),
  );
  check(
    '/api/v1/profiles/:id/benchmarks reaches ai-content, not user-provider',
    r.status === 200 && strip(r.body.data ?? []) === strip(list),
    r.status,
  );
  r = await call(
    await fetch(`${GATEWAY}/api/v1/reference-ranges?marker=${MARKERS.high}`, {
      headers: authHeaders,
    }),
  );
  check('/api/v1/reference-ranges reaches ai-content', r.status === 200, r);

  r = await call(await fetch(`${GATEWAY}/api/v1/profiles`, { headers: authHeaders }));
  check('and the rest of /profiles still goes to user-provider', r.status === 200, r.status);
}

// ── 7. Audit ─────────────────────────────────────────────────────────────────

console.log('\n6. Reads and refusals are both recorded, under their own name');

const audit = await ai`
  SELECT action, actor_id, success FROM phi_access_log
  WHERE profile_id = ${dadId}::uuid
  ORDER BY occurred_at
`;
const benchmarkRows = audit.filter((row: any) => row.action === 'benchmarks.read');
check('benchmark reads are logged', benchmarkRows.length > 0, audit.length);
check(
  'the provider’s successful read is attributed to the provider',
  benchmarkRows.some((row: any) => row.actor_id === PROVIDER_AUTH_ID && row.success === true),
);
check(
  'the other account’s refusal is logged against that account',
  benchmarkRows.some((row: any) => row.actor_id === OTHER_AUTH_ID && row.success === false),
);
check(
  'no benchmark read was logged as a reports read',
  !audit.some((row: any) => row.action === 'reports.timeline'),
  audit.map((row: any) => row.action),
);

// ── Teardown ─────────────────────────────────────────────────────────────────

// Corrections point at what they correct, so they go first.
await ai`DELETE FROM biomarker_readings WHERE profile_id = ${dadId}::uuid AND supersedes_id IS NOT NULL`;
await ai`DELETE FROM biomarker_readings WHERE profile_id = ${dadId}::uuid`;
if (createdRangeIds.length > 0) {
  await ai`DELETE FROM reference_ranges WHERE id IN ${ai(createdRangeIds)}`;
}
await ai`DELETE FROM documents WHERE id IN (${reportId}::uuid, ${deletedReportId}::uuid)`;
if (bookingId) await bookingDb`DELETE FROM bookings WHERE id = ${bookingId}::uuid`;
if (dadId)
  await fetch(`${USER_PROVIDER}/profiles/${dadId}`, { method: 'DELETE', headers: authHeaders });
await core.end();
await ai.end();
await bookingDb.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
