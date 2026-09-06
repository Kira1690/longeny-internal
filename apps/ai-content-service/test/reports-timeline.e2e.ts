/**
 * End-to-end tests for the profile reports timeline (Week 7, card W7-7).
 *
 * Real services, real PostgreSQL, real S3 metadata path — no mocks. Requires
 * user-provider-service on :3002, booking-service on :3003 (it decides provider
 * access) and ai-content-service on :3004.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/reports-timeline.e2e.ts
 *
 * The rule under test: a provider sees a profile's reports through an active
 * booking and through nothing else, and a provider with no engagement gets the
 * same answer as a stranger.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const BOOKING = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3003';

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
      email: `w7rep-${RUN}@longeny.test`,
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

const authHeaders = { Authorization: `Bearer ${mintToken()}`, 'Content-Type': 'application/json' };
const otherAccountHeaders = {
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w7rep-other-${RUN}@longeny.test` })}`,
  'Content-Type': 'application/json',
};
const providerHeaders = {
  Authorization: `Bearer ${mintToken({
    sub: PROVIDER_AUTH_ID,
    email: `w7rep-doc-${RUN}@longeny.test`,
    role: 'provider',
    roles: ['provider'],
    permissions: ['documents:read', 'profiles:read', 'bookings:read'],
  })}`,
  'Content-Type': 'application/json',
};
const unbookedProviderHeaders = {
  Authorization: `Bearer ${mintToken({
    sub: UNBOOKED_PROVIDER_ID,
    email: `w7rep-doc2-${RUN}@longeny.test`,
    role: 'provider',
    roles: ['provider'],
    permissions: ['documents:read', 'profiles:read', 'bookings:read'],
  })}`,
  'Content-Type': 'application/json',
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
    VALUES (${authId}::uuid, ${`w7rep-${label}-${RUN}@longeny.test`}, ${`W7${label}`}, 'Reports')
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

r = await call(await fetch(`${USER_PROVIDER}/profiles`, { headers: authHeaders }));
const selfId: string = r.body.data?.find((p: any) => p.is_self)?.id;

// ── 1. An uploaded report belongs to a subject of care ───────────────────────

console.log('\n1. Upload is scoped to the active profile');

const upload = async (profileId: string, title: string, reportedAt: string) =>
  call(
    await fetch(`${BASE}/documents/upload`, {
      method: 'POST',
      headers: { ...authHeaders, 'X-Active-Profile-Id': profileId },
      body: JSON.stringify({
        title,
        fileName: `${title.replace(/\s+/g, '-')}.pdf`,
        fileSize: 2048,
        mimeType: 'application/pdf',
        documentType: 'lab_report',
        reportedAt,
      }),
    }),
  );

const older = new Date(Date.now() - 90 * 86_400_000).toISOString();
const newer = new Date(Date.now() - 7 * 86_400_000).toISOString();

// Uploaded oldest-first so upload order and report order disagree — the point of
// ordering by report date is that these two are not the same thing.
r = await upload(dadId, `HbA1c ${RUN}`, older);
check('201 Created', r.status === 201, r);
const firstDocId: string = r.body.data?.documentId;

r = await upload(dadId, `Lipids ${RUN}`, newer);
const secondDocId: string = r.body.data?.documentId;
check('second report uploaded', r.status === 201, r);

r = await upload(selfId, `Own bloods ${RUN}`, newer);
const ownDocId: string = r.body.data?.documentId;

const rows = await ai`
  SELECT id, profile_id, reported_at FROM documents
  WHERE id IN (${firstDocId}::uuid, ${secondDocId}::uuid, ${ownDocId}::uuid)
`;
check(
  'all three rows carry a profile',
  rows.every((row: any) => Boolean(row.profile_id)),
  rows,
);
check(
  'the father’s two are his',
  rows.filter((row: any) => row.profile_id === dadId).length === 2,
  rows,
);
check(
  'and the account owner’s is separate',
  rows.some((row: any) => row.profile_id === selfId),
  rows,
);
check(
  'the report date was stored, not just the upload date',
  rows.every((row: any) => Boolean(row.reported_at)),
  rows,
);

// ── 2. The timeline ──────────────────────────────────────────────────────────

console.log('\n2. GET /profiles/:id/reports');

r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: authHeaders }));
check('200 OK', r.status === 200, r);
check('two reports for the father', (r.body.data ?? []).length === 2, r.body.data);
check(
  'newest report date first, not newest upload first',
  r.body.data?.[0]?.title === `Lipids ${RUN}`,
  r.body.data?.map((d: any) => d.title),
);
check(
  'the account owner’s own report is not in the father’s timeline',
  !(r.body.data ?? []).some((d: any) => d.id === ownDocId),
  r.body.data,
);

r = await call(await fetch(`${BASE}/profiles/${selfId}/reports`, { headers: authHeaders }));
check(
  'and the account owner’s timeline holds only theirs',
  (r.body.data ?? []).length === 1,
  r.body.data,
);

// ── 3. Another account ───────────────────────────────────────────────────────

console.log('\n3. Another account cannot read this family’s reports');

r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: otherAccountHeaders }));
check('404, never 403', r.status === 404, r);

r = await call(
  await fetch(`${BASE}/documents/${firstDocId}/download`, { headers: otherAccountHeaders }),
);
check('and cannot presign a download for it', r.status === 403 || r.status === 404, r);

r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`));
check('no token → 401', r.status === 401, r);

// ── 4. Provider access comes from a booking, and only from that ──────────────

console.log('\n4. A provider reads a profile’s reports only through an active booking');

r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: providerHeaders }));
check('before any booking, the provider gets 404 — same as a stranger', r.status === 404, r);

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
check('the family books that provider', r.status === 201, r);
const bookingId: string = r.body.data?.id;

r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: providerHeaders }));
check('now the provider can read the timeline', r.status === 200, r);
check('and sees the same two reports', (r.body.data ?? []).length === 2, r.body.data);

r = await call(
  await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: unbookedProviderHeaders }),
);
check('a different provider still cannot', r.status === 404, r);

await bookingDb`UPDATE bookings SET status = 'cancelled' WHERE id = ${bookingId}::uuid`;
r = await call(await fetch(`${BASE}/profiles/${dadId}/reports`, { headers: providerHeaders }));
check('cancelling the booking closes the access again', r.status === 404, r);

// ── 5. The access is audited ─────────────────────────────────────────────────

console.log('\n5. Reads and refusals are both recorded');

const auditRows = await ai`
  SELECT actor_id, status_code, success FROM phi_access_log
  WHERE profile_id = ${dadId}::uuid AND action = 'reports.timeline'
  ORDER BY occurred_at
`;
check('the timeline reads are logged', auditRows.length > 0, auditRows.length);
check(
  'the provider’s successful read is attributed to the provider',
  auditRows.some((row: any) => row.actor_id === PROVIDER_AUTH_ID && row.success === true),
  auditRows,
);
check(
  'the refusals are logged too',
  auditRows.some((row: any) => row.success === false),
  auditRows.filter((row: any) => !row.success).length,
);
check(
  'the other account’s refusal is attributed to that account, not to the family',
  auditRows.some((row: any) => row.actor_id === OTHER_AUTH_ID && row.success === false),
  auditRows.filter((row: any) => row.actor_id === OTHER_AUTH_ID),
);

// ── Teardown ─────────────────────────────────────────────────────────────────

await ai`DELETE FROM documents WHERE id IN (${firstDocId}::uuid, ${secondDocId}::uuid, ${ownDocId}::uuid)`;
await bookingDb`DELETE FROM bookings WHERE id = ${bookingId}::uuid`;
if (dadId)
  await fetch(`${USER_PROVIDER}/profiles/${dadId}`, { method: 'DELETE', headers: authHeaders });
await core.end();
await ai.end();
await bookingDb.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
