/**
 * End-to-end tests for booking-service ownership, role separation, request
 * validation and the HMAC gate on `/internal/*`.
 *
 * Real service, real PostgreSQL, real Redis — no mocks, no stubs. Requires:
 *   1. Postgres up with the `longeny_bookings` schema pushed (bunx drizzle-kit push)
 *   2. Redis up (the create path takes a distributed slot lock)
 *   3. booking-service running (default :3023 — a spare port, so it never
 *      collides with the :3003 instance a developer may already have running)
 *
 * Run:
 *   set -a; source .env; set +a
 *   BOOKING_SERVICE_PORT=3023 bun run apps/booking-service/src/index.ts &
 *   bun run apps/booking-service/test/bookings-ownership.e2e.ts
 *
 * Every account, provider and booking is minted fresh per run and deleted at
 * the end, so consecutive runs never contend for the same slot or lock.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 *
 * What it proves, by section:
 *   1    Bookings can be created, and the fixtures the rest of the suite needs
 *        come from the API rather than from hand-written rows.
 *   2    M5 — every ownership-scoped route answers a foreign booking exactly as
 *        it answers an id that does not exist, byte for byte.
 *   3    Role denial (403, from the route guard) and ownership denial (404, from
 *        the service) are distinct and both present on the provider routes.
 *   4    Create, update, cancel and reschedule reject malformed bodies with
 *        400 VALIDATION_ERROR.
 *   5    Full lifecycle, each step confirmed by querying longeny_bookings.
 *   6    `/internal/*` refuses a bad HMAC signature and missing HMAC headers.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3023';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
const BOOKING_DATABASE_URL = process.env.BOOKING_DATABASE_URL;
if (!JWT_SECRET || !HMAC_SECRET || !BOOKING_DATABASE_URL) {
  console.error(
    'JWT_ACCESS_SECRET / HMAC_SECRET / BOOKING_DATABASE_URL missing — did you `source .env`?',
  );
  process.exit(1);
}

// ── Identities ───────────────────────────────────────────────────────────────
// Fresh per run. Two patients and two providers, so "someone else's booking" is
// a real row owned by a real other account rather than a missing one — the only
// arrangement in which the ownership branch is actually exercised.

const PATIENT = crypto.randomUUID();
const OTHER_PATIENT = crypto.randomUUID();
const PROVIDER = crypto.randomUUID();
const OTHER_PROVIDER = crypto.randomUUID();
/** A well-formed UUID that belongs to nothing. */
const GHOST_ID = crypto.randomUUID();

/** Permissions the `user` and `provider` roles hold for bookings. */
const BOOKING_PERMISSIONS = ['bookings:read', 'bookings:write', 'bookings:cancel'];

interface TokenClaims {
  sub?: string;
  email?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
}

function mintToken(claims: TokenClaims = {}): string {
  return jwt.sign(
    {
      sub: PATIENT,
      email: 'bookings.e2e@longeny.com',
      role: 'user',
      roles: ['user'],
      permissions: BOOKING_PERMISSIONS,
      jti: crypto.randomUUID(),
      ...claims,
    },
    JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const json = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const patientHeaders = json(mintToken());
const otherPatientHeaders = json(
  mintToken({ sub: OTHER_PATIENT, email: 'other.patient.e2e@longeny.com' }),
);
const providerHeaders = json(
  mintToken({
    sub: PROVIDER,
    email: 'provider.e2e@longeny.com',
    role: 'provider',
    roles: ['provider'],
  }),
);
const otherProviderHeaders = json(
  mintToken({
    sub: OTHER_PROVIDER,
    email: 'other.provider.e2e@longeny.com',
    role: 'provider',
    roles: ['provider'],
  }),
);
/** Authenticated with the right role but none of the booking permissions. */
const noPermissionHeaders = json(mintToken({ permissions: ['users:read'] }));

// ── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

interface ApiResult {
  status: number;
  /** The exact bytes the service sent, kept for the byte-equality checks. */
  raw: string;
  body: unknown;
}

async function request(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Leave `parsed` as the raw text — a non-JSON body is itself a finding.
  }
  return { status: res.status, raw, body: parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorField(body: unknown, field: 'code' | 'message'): string {
  if (!isRecord(body)) return '';
  const error = body.error;
  if (!isRecord(error)) return '';
  const value = error[field];
  return typeof value === 'string' ? value : '';
}

function dataRecord(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  return isRecord(body.data) ? body.data : {};
}

/**
 * A 404 body echoes the id that was asked for, so two 404s for different ids
 * can never be literally equal. Substituting the queried id and the response
 * timestamp — the only two fields that are *allowed* to differ — leaves exactly
 * the bytes that must not differ. Any wording, code or detail that betrays
 * whether the row exists makes the two fingerprints diverge and fails the check.
 */
function fingerprint(raw: string, id: string): string {
  return raw
    .replaceAll(id, '<queried-id>')
    .replace(/"timestamp":"[^"]*"/, '"timestamp":"<timestamp>"');
}

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

/** Mirrors signRequest() in @longeny/middleware — signs over the raw body string. */
function hmacHeaders(
  service: string,
  method: string,
  path: string,
  body: string,
  overrides: { timestamp?: string; signature?: string } = {},
): Record<string, string> {
  const timestamp = overrides.timestamp ?? Date.now().toString();
  const signature =
    overrides.signature ??
    crypto
      .createHmac('sha256', HMAC_SECRET as string)
      .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256(body)}`)
      .digest('hex');
  return {
    'X-Service-Name': service,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
    'Content-Type': 'application/json',
  };
}

// ── Preflight ────────────────────────────────────────────────────────────────

try {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (err) {
  console.error(`booking-service not reachable at ${BASE} — start it first.\n  ${err}`);
  process.exit(1);
}

const sql = postgres(BOOKING_DATABASE_URL as string);

// Each run books a distinct hour far enough ahead that all three reminder
// offsets are still in the future, so the reminder rows are exercised too.
const runOffsetHours = 96 + Math.floor(Math.random() * 500);

function slot(index: number): { startTime: string; endTime: string } {
  const start = new Date(Date.now() + (runOffsetHours + index * 3) * 3_600_000);
  start.setUTCMinutes(0, 0, 0);
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3_600_000).toISOString(),
  };
}

async function createBooking(
  headers: Record<string, string>,
  providerId: string,
  index: number,
  notes: string,
): Promise<ApiResult> {
  return request('POST', '/bookings', headers, {
    providerId,
    // 'consultation' is the only value both the request schema and the
    // `session_type` database enum agree on — see §4 for the rest.
    sessionType: 'consultation',
    ...slot(index),
    timezone: 'UTC',
    notes,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fixtures — two real bookings, created through the API
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n1. Two accounts each create a real booking through the API');

const mine = await createBooking(patientHeaders, PROVIDER, 0, 'bookings-ownership.e2e own');
check('POST /bookings returns 201 for the booking account', mine.status === 201, {
  status: mine.status,
  body: mine.body,
});

const theirs = await createBooking(
  otherPatientHeaders,
  OTHER_PROVIDER,
  1,
  'bookings-ownership.e2e foreign',
);
check('POST /bookings returns 201 for the second account', theirs.status === 201, {
  status: theirs.status,
  body: theirs.body,
});

const myBookingId = String(dataRecord(mine.body).id ?? '');
const theirBookingId = String(dataRecord(theirs.body).id ?? '');

if (!myBookingId || !theirBookingId) {
  console.error('\nFixtures could not be created — the rest of the suite has nothing to assert.');
  console.log(`\n=== RESULT: ${passed} passed, ${failed + 1} failed ===\n`);
  await sql.end();
  process.exit(1);
}

const createdBookingIds = [myBookingId, theirBookingId];

const unauthenticated = await request('GET', `/bookings/${myBookingId}`, {
  'Content-Type': 'application/json',
});
check(
  'reading a booking with no token → 401',
  unauthenticated.status === 401 && errorField(unauthenticated.body, 'code') === 'UNAUTHORIZED',
  { status: unauthenticated.status, body: unauthenticated.body },
);

const withoutPermission = await request('GET', `/bookings/${myBookingId}`, noPermissionHeaders);
check(
  'reading a booking without bookings:read → 403 naming the permission',
  withoutPermission.status === 403 &&
    errorField(withoutPermission.body, 'message') === 'Requires permission: bookings:read',
  { status: withoutPermission.status, body: withoutPermission.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ownership answers 404, byte-identical to a nonexistent id (M5)
// ─────────────────────────────────────────────────────────────────────────────
// Each route is asked twice with the same caller: once for a booking that is
// real but belongs to somebody else, once for an id that belongs to nobody. The
// two answers must be the same bytes, or the route is an existence oracle.

console.log("\n2. Someone else's booking is indistinguishable from one that does not exist");

interface OwnershipCase {
  label: string;
  method: string;
  path: (id: string) => string;
  headers: Record<string, string>;
  body?: unknown;
}

const reschedule = slot(9);
const ownershipCases: OwnershipCase[] = [
  {
    label: 'getBooking — GET /bookings/:id',
    method: 'GET',
    path: (id) => `/bookings/${id}`,
    headers: patientHeaders,
  },
  {
    label: 'updateBooking — PUT /bookings/:id',
    method: 'PUT',
    path: (id) => `/bookings/${id}`,
    headers: patientHeaders,
    body: { notes: 'an update this account is not entitled to make' },
  },
  {
    label: 'cancelBooking — PATCH /bookings/:id/cancel',
    method: 'PATCH',
    path: (id) => `/bookings/${id}/cancel`,
    headers: patientHeaders,
    body: { reason: 'a cancellation this account is not entitled to make' },
  },
  {
    label: 'rescheduleBooking — PATCH /bookings/:id/reschedule',
    method: 'PATCH',
    path: (id) => `/bookings/${id}/reschedule`,
    headers: patientHeaders,
    body: { newStartTime: reschedule.startTime, newEndTime: reschedule.endTime },
  },
  {
    label: 'confirmBooking — PATCH /bookings/:id/confirm',
    method: 'PATCH',
    path: (id) => `/bookings/${id}/confirm`,
    headers: providerHeaders,
  },
  {
    label: 'completeBooking — PATCH /bookings/:id/complete',
    method: 'PATCH',
    path: (id) => `/bookings/${id}/complete`,
    headers: providerHeaders,
  },
  {
    label: 'markNoShow — PATCH /bookings/:id/no-show',
    method: 'PATCH',
    path: (id) => `/bookings/${id}/no-show`,
    headers: providerHeaders,
  },
];

for (const testCase of ownershipCases) {
  const foreign = await request(
    testCase.method,
    testCase.path(theirBookingId),
    testCase.headers,
    testCase.body,
  );
  const ghost = await request(
    testCase.method,
    testCase.path(GHOST_ID),
    testCase.headers,
    testCase.body,
  );

  check(
    `${testCase.label}: a booking owned by another account → 404, not 403`,
    foreign.status === 404 && errorField(foreign.body, 'code') === 'NOT_FOUND',
    { status: foreign.status, body: foreign.body },
  );
  check(
    `${testCase.label}: the two response bodies are equal once the echoed id is normalised`,
    fingerprint(foreign.raw, theirBookingId) === fingerprint(ghost.raw, GHOST_ID),
    {
      foreign: fingerprint(foreign.raw, theirBookingId),
      ghost: fingerprint(ghost.raw, GHOST_ID),
    },
  );
}

const [untouched] = await sql<{ status: string; notes: string | null }[]>`
  SELECT status, notes FROM bookings WHERE id = ${theirBookingId}::uuid
`;
check(
  'none of those rejected calls changed the other account’s row',
  untouched?.status === 'pending' && untouched?.notes === 'bookings-ownership.e2e foreign',
  untouched,
);

const listedByOther = await request('GET', '/bookings', otherPatientHeaders);
const otherListIds = (() => {
  const body = listedByOther.body;
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  return body.data.filter(isRecord).map((row) => String(row.id));
})();
check(
  'the other account’s own listing shows its booking and not this account’s',
  otherListIds.includes(theirBookingId) && !otherListIds.includes(myBookingId),
  { otherListIds },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Role denial and ownership denial are different answers
// ─────────────────────────────────────────────────────────────────────────────
// Same route, same booking, two callers. The patient is stopped by the route's
// role guard and must see 403. A provider who simply does not own the booking
// is stopped by the service and must see 404 — telling them "forbidden" would
// confirm the id is real.

console.log(
  '\n3. A wrong role gets 403 from the route; a wrong provider gets 404 from the service',
);

const providerOnlyRoutes = [
  { label: 'confirm', path: `/bookings/${myBookingId}/confirm` },
  { label: 'complete', path: `/bookings/${myBookingId}/complete` },
  { label: 'no-show', path: `/bookings/${myBookingId}/no-show` },
];

for (const route of providerOnlyRoutes) {
  const asPatient = await request('PATCH', route.path, patientHeaders);
  check(
    `${route.label}: a patient token is refused by the role guard → 403 naming the role`,
    asPatient.status === 403 &&
      errorField(asPatient.body, 'code') === 'FORBIDDEN' &&
      errorField(asPatient.body, 'message') === 'Requires one of roles: provider',
    { status: asPatient.status, body: asPatient.body },
  );

  const asOtherProvider = await request('PATCH', route.path, otherProviderHeaders);
  check(
    `${route.label}: a different provider is refused by the service → 404, not 403`,
    asOtherProvider.status === 404 && errorField(asOtherProvider.body, 'code') === 'NOT_FOUND',
    { status: asOtherProvider.status, body: asOtherProvider.body },
  );
}

const providerListAsPatient = await request('GET', '/bookings/provider', patientHeaders);
check(
  'GET /bookings/provider is role-gated too — a patient token → 403',
  providerListAsPatient.status === 403 &&
    errorField(providerListAsPatient.body, 'message') === 'Requires one of roles: provider',
  { status: providerListAsPatient.status, body: providerListAsPatient.body },
);

const providerListAsOther = await request('GET', '/bookings/provider', otherProviderHeaders);
const otherProviderIds = (() => {
  const body = providerListAsOther.body;
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  return body.data.filter(isRecord).map((row) => String(row.id));
})();
check(
  'a provider’s own list is scoped to their bookings — it does not contain another provider’s',
  providerListAsOther.status === 200 && !otherProviderIds.includes(myBookingId),
  { status: providerListAsOther.status, otherProviderIds },
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Write routes reject malformed bodies
// ─────────────────────────────────────────────────────────────────────────────
// Sent with a token holding every booking permission, so a 400 can only have
// come from body validation and not from a guard.

console.log('\n4. Create, update, cancel and reschedule reject malformed bodies');

const validSlot = slot(20);
const malformedWrites: Array<{ label: string; method: string; path: string; body: unknown }> = [
  { label: 'POST /bookings — empty body', method: 'POST', path: '/bookings', body: {} },
  {
    label: 'POST /bookings — providerId is not a uuid',
    method: 'POST',
    path: '/bookings',
    body: { providerId: 'provider-one', sessionType: 'consultation', ...validSlot },
  },
  {
    label: 'POST /bookings — startTime is not ISO-8601',
    method: 'POST',
    path: '/bookings',
    body: {
      providerId: PROVIDER,
      sessionType: 'consultation',
      startTime: 'next tuesday',
      endTime: validSlot.endTime,
    },
  },
  {
    label: 'POST /bookings — unknown sessionType',
    method: 'POST',
    path: '/bookings',
    body: { providerId: PROVIDER, sessionType: 'seance', ...validSlot },
  },
  {
    label: 'PUT /bookings/:id — startTime is not ISO-8601',
    method: 'PUT',
    path: `/bookings/${myBookingId}`,
    body: { startTime: 'yesterday' },
  },
  {
    label: 'PUT /bookings/:id — notes is not a string',
    method: 'PUT',
    path: `/bookings/${myBookingId}`,
    body: { notes: { text: 'not a string' } },
  },
  {
    label: 'PATCH /bookings/:id/cancel — reason is not a string',
    method: 'PATCH',
    path: `/bookings/${myBookingId}/cancel`,
    body: { reason: 12345 },
  },
  {
    label: 'PATCH /bookings/:id/reschedule — empty body',
    method: 'PATCH',
    path: `/bookings/${myBookingId}/reschedule`,
    body: {},
  },
  {
    label: 'PATCH /bookings/:id/reschedule — newStartTime is not ISO-8601',
    method: 'PATCH',
    path: `/bookings/${myBookingId}/reschedule`,
    body: { newStartTime: 'soon', newEndTime: validSlot.endTime },
  },
];

for (const testCase of malformedWrites) {
  const result = await request(testCase.method, testCase.path, patientHeaders, testCase.body);
  check(
    `${testCase.label} → 400 VALIDATION_ERROR`,
    result.status === 400 && errorField(result.body, 'code') === 'VALIDATION_ERROR',
    { status: result.status, body: result.body },
  );
}

// A request schema that accepts a value the storage layer cannot hold is not
// validation — it just moves the rejection from a 400 to a 500.
const acceptedButUnstorable = await request('POST', '/bookings', patientHeaders, {
  providerId: PROVIDER,
  sessionType: 'one_on_one',
  ...slot(30),
  timezone: 'UTC',
  notes: 'bookings-ownership.e2e session_type drift',
});
check(
  'every sessionType the request schema accepts is one the service can store',
  acceptedButUnstorable.status !== 500,
  { status: acceptedButUnstorable.status, body: acceptedButUnstorable.body },
);
const driftId = String(dataRecord(acceptedButUnstorable.body).id ?? '');
if (driftId) createdBookingIds.push(driftId);

const [afterMalformed] = await sql<{ status: string; notes: string | null }[]>`
  SELECT status, notes FROM bookings WHERE id = ${myBookingId}::uuid
`;
check(
  'no rejected body reached the database — the booking is untouched',
  afterMalformed?.status === 'pending' && afterMalformed?.notes === 'bookings-ownership.e2e own',
  afterMalformed,
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Full lifecycle, verified in longeny_bookings at every step
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Lifecycle: create → confirm → cancel, each step confirmed in the database');

const lifecycleNotes = `bookings-ownership.e2e lifecycle ${crypto.randomUUID()}`;
const created = await createBooking(patientHeaders, PROVIDER, 40, lifecycleNotes);
check('the lifecycle booking is created', created.status === 201, {
  status: created.status,
  body: created.body,
});

const lifecycleId = String(dataRecord(created.body).id ?? '');
if (lifecycleId) createdBookingIds.push(lifecycleId);

const [row] = await sql<
  {
    id: string;
    user_id: string;
    provider_id: string;
    status: string;
    session_type: string;
    notes: string | null;
    duration_minutes: number;
  }[]
>`
  SELECT id, user_id, provider_id, status, session_type, notes, duration_minutes
  FROM bookings WHERE id = ${lifecycleId}::uuid
`;
check(
  'the row exists in longeny_bookings with the calling account as its owner',
  row?.id === lifecycleId && row?.user_id === PATIENT && row?.provider_id === PROVIDER,
  row,
);
check(
  'the stored row carries what was requested, not defaults',
  row?.status === 'pending' &&
    row?.session_type === 'consultation' &&
    row?.notes === lifecycleNotes &&
    row?.duration_minutes === 60,
  row,
);

const reminderRows = await sql<{ reminder_type: string; user_id: string }[]>`
  SELECT reminder_type, user_id FROM booking_reminders WHERE booking_id = ${lifecycleId}::uuid
`;
check(
  'the three reminders were written alongside the booking, for the booking account',
  reminderRows.length === 3 && reminderRows.every((r) => r.user_id === PATIENT),
  reminderRows,
);

const confirmed = await request('PATCH', `/bookings/${lifecycleId}/confirm`, providerHeaders);
check('the owning provider can confirm it', confirmed.status === 200, {
  status: confirmed.status,
  body: confirmed.body,
});

const [afterConfirm] = await sql<{ status: string }[]>`
  SELECT status FROM bookings WHERE id = ${lifecycleId}::uuid
`;
check(
  'the database shows the booking confirmed — not just the response',
  afterConfirm?.status === 'confirmed',
  afterConfirm,
);

const cancelReason = 'bookings-ownership.e2e teardown cancel';
const cancelled = await request('PATCH', `/bookings/${lifecycleId}/cancel`, patientHeaders, {
  reason: cancelReason,
});
check('the booking account can cancel it', cancelled.status === 200, {
  status: cancelled.status,
  body: cancelled.body,
});

const [afterCancel] = await sql<
  { status: string; cancelled_by: string | null; cancellation_reason: string | null }[]
>`
  SELECT status, cancelled_by, cancellation_reason FROM bookings WHERE id = ${lifecycleId}::uuid
`;
check(
  'the database shows it cancelled, by the user, with the reason given',
  afterCancel?.status === 'cancelled' &&
    afterCancel?.cancelled_by === 'user' &&
    afterCancel?.cancellation_reason === cancelReason,
  afterCancel,
);

const reconfirm = await request('PATCH', `/bookings/${lifecycleId}/confirm`, providerHeaders);
check(
  'a cancelled booking cannot be confirmed again → 400, and the status is a real check',
  reconfirm.status === 400,
  { status: reconfirm.status, body: reconfirm.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. /internal/* is gated by HMAC
// ─────────────────────────────────────────────────────────────────────────────
// booking-service exposes GDPR export (GET) and erasure (DELETE) internally.
// Erasure is only ever exercised here with an invalid signature, so nothing is
// deleted; the signed positive case uses the read route.

console.log('\n6. /internal/* refuses unsigned and mis-signed inter-service calls');

const exportPath = `/internal/gdpr/user-data/${PATIENT}`;
const erasePath = `/internal/gdpr/user-data/${OTHER_PATIENT}`;

const noHmac = await request('GET', exportPath, { 'Content-Type': 'application/json' });
check(
  'GET /internal/* with no HMAC headers → 401',
  noHmac.status === 401 &&
    errorField(noHmac.body, 'message') === 'Missing HMAC authentication headers',
  { status: noHmac.status, body: noHmac.body },
);

const badSignature = await request(
  'GET',
  exportPath,
  hmacHeaders('user-provider-service', 'GET', exportPath, '', { signature: 'f'.repeat(64) }),
);
check(
  'GET /internal/* with a bad HMAC signature → 401',
  badSignature.status === 401 &&
    errorField(badSignature.body, 'message') === 'Invalid HMAC signature',
  { status: badSignature.status, body: badSignature.body },
);

const wrongSecret = crypto
  .createHmac('sha256', 'not-the-shared-secret')
  .update(`GET\n${exportPath}\n${Date.now()}\n${sha256('')}`)
  .digest('hex');
const forged = await request(
  'GET',
  exportPath,
  hmacHeaders('user-provider-service', 'GET', exportPath, '', { signature: wrongSecret }),
);
check(
  'a signature computed with the wrong secret → 401',
  forged.status === 401 && errorField(forged.body, 'message') === 'Invalid HMAC signature',
  { status: forged.status, body: forged.body },
);

const stale = await request(
  'GET',
  exportPath,
  hmacHeaders('user-provider-service', 'GET', exportPath, '', {
    timestamp: (Date.now() - 120_000).toString(),
  }),
);
check(
  'a correctly signed but replayed request outside the window → 401',
  stale.status === 401 &&
    errorField(stale.body, 'message') === 'Request timestamp outside acceptable window',
  { status: stale.status, body: stale.body },
);

const eraseNoHmac = await request('DELETE', erasePath, { 'Content-Type': 'application/json' });
check(
  'DELETE /internal/* with no HMAC headers → 401',
  eraseNoHmac.status === 401 &&
    errorField(eraseNoHmac.body, 'message') === 'Missing HMAC authentication headers',
  { status: eraseNoHmac.status, body: eraseNoHmac.body },
);

const eraseBadSignature = await request(
  'DELETE',
  erasePath,
  hmacHeaders('user-provider-service', 'DELETE', erasePath, '', { signature: 'a'.repeat(64) }),
);
check(
  'DELETE /internal/* with a bad HMAC signature → 401',
  eraseBadSignature.status === 401 &&
    errorField(eraseBadSignature.body, 'message') === 'Invalid HMAC signature',
  { status: eraseBadSignature.status, body: eraseBadSignature.body },
);

const [notErased] = await sql<{ count: number }[]>`
  SELECT COUNT(*)::int AS count FROM bookings WHERE user_id = ${OTHER_PATIENT}::uuid
`;
check('the refused erasure deleted nothing', notErased?.count === 1, notErased);

// A user access token is not an inter-service credential and must not be
// accepted in place of one.
const bearerOnInternal = await request('GET', exportPath, patientHeaders);
check(
  'a valid user Bearer token is not accepted on /internal/* → 401',
  bearerOnInternal.status === 401,
  { status: bearerOnInternal.status, body: bearerOnInternal.body },
);

const signed = await request(
  'GET',
  exportPath,
  hmacHeaders('user-provider-service', 'GET', exportPath, ''),
);
check(
  'a correctly signed call is let through — the gate rejects on the signature, not on principle',
  signed.status === 200,
  { status: signed.status, body: signed.body },
);

const noPostRoute = await request(
  'POST',
  exportPath,
  hmacHeaders('user-provider-service', 'POST', exportPath, ''),
);
check(
  'booking-service exposes no POST /internal/* route at all — nothing unguarded hides behind one',
  noPostRoute.status === 404 && errorField(noPostRoute.body, 'message') === 'Route not found',
  { status: noPostRoute.status, body: noPostRoute.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// Teardown — every row this run created, in foreign-key order.
// ─────────────────────────────────────────────────────────────────────────────

const accounts = [PATIENT, OTHER_PATIENT];
await sql`DELETE FROM booking_reminders WHERE user_id = ANY(${accounts}::uuid[])`;
await sql`DELETE FROM booking_reminders WHERE booking_id = ANY(${createdBookingIds}::uuid[])`;
await sql`DELETE FROM bookings WHERE user_id = ANY(${accounts}::uuid[])`;
await sql`DELETE FROM bookings WHERE id = ANY(${createdBookingIds}::uuid[])`;
await sql.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
