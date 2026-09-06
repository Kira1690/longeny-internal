/**
 * End-to-end tests for the compliance surfaces of user-provider-service:
 * encryption at rest, the PHI access log, GDPR export and erasure, per-account
 * rate limiting, and identity under concurrency.
 *
 * Every assertion about stored data is made against PostgreSQL directly. An HTTP
 * response saying "created" is the claim under test, not the evidence for it —
 * these are exactly the properties (a column is ciphertext, a row is gone, an
 * audit row names the right actor) that a response body cannot demonstrate.
 *
 * What this pins, from plan/rro/week-06-audit-findings.md:
 *   H1     `*_hash` columns held plaintext beside their own ciphertext
 *   M3     the "append-only" audit tables were freely mutable
 *   M1     GDPR export and erasure ignored all seven RRO tables
 *   C1/C2  request identity lived in a process-global, so concurrent requests
 *          read each other's data and the audit log named the wrong actor
 *
 * Real service, real PostgreSQL, real Redis — no mocks. Requires:
 *   1. Postgres + Redis up, `longeny_core` schema pushed (bunx drizzle-kit push)
 *   2. The append-only triggers applied (src/db/enforce-append-only.sql)
 *   3. user-provider-service running on :3002
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/test/compliance.e2e.ts
 *
 * Re-runnable: every account id is minted fresh per run, and the accounts this
 * suite creates are the only ones it touches. It never erases a seeded account
 * another suite depends on.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3002';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
const CORE_DATABASE_URL = process.env.CORE_DATABASE_URL;
if (!JWT_SECRET || !HMAC_SECRET || !CORE_DATABASE_URL) {
  console.error(
    'JWT_ACCESS_SECRET / HMAC_SECRET / CORE_DATABASE_URL missing — did you `source .env`?',
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

interface ApiResult {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

async function call(res: Response): Promise<ApiResult> {
  const text = await res.text();
  try {
    return { status: res.status, headers: res.headers, body: JSON.parse(text) as unknown, text };
  } catch {
    return { status: res.status, headers: res.headers, body: text, text };
  }
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}
const envelope = (body: unknown): Envelope => (body ?? {}) as Envelope;
const record = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;
const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Mirrors signRequest() in @longeny/middleware — signs over the raw body string. */
function hmacHeaders(service: string, method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const signature = crypto
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

/** Permissions the `user` role holds — see auth-service seed rolePermissionMap. */
const USER_PERMISSIONS = [
  'profiles:read',
  'profiles:write',
  'consent:grant',
  'rro:read',
  'users:read',
  'users:write',
  'progress:read',
  'progress:write',
];

function mintToken(sub: string, claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub,
      email: `${sub}@compliance.test`,
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

/**
 * Audit rows are written in `onAfterResponse`, after the response has already
 * reached us. Asserting on them the instant a fetch resolves is a race, so every
 * database assertion about a request that just happened polls briefly first.
 */
async function waitFor<T>(
  probeFn: () => Promise<T>,
  satisfied: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probeFn();
  while (!satisfied(last) && Date.now() < deadline) {
    await Bun.sleep(100);
    last = await probeFn();
  }
  return last;
}

/** Every string value anywhere in a JSON structure, for "does this leak X" checks. */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) deepStrings(item, out);
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value)) deepStrings(item, out);
  return out;
}

/** Every object key anywhere in a JSON structure. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) deepKeys(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      deepKeys(item, out);
    }
  }
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Four fresh accounts per run. Fresh matters twice over: it makes the suite
// re-runnable, and it means the erasure section destroys an account this run
// built rather than one another suite is asserting on.

const RUN = Date.now();
const SUBJECT_AUTH_ID = crypto.randomUUID(); // the data subject: encryption, audit, export
const OTHER_AUTH_ID = crypto.randomUUID(); // a second tenant: denials and concurrency
const ERASE_AUTH_ID = crypto.randomUUID(); // built to be erased
const LIMIT_AUTH_ID = crypto.randomUUID(); // rate-limit budget, kept off the others

const subjectToken = mintToken(SUBJECT_AUTH_ID);
const otherToken = mintToken(OTHER_AUTH_ID);
const eraseToken = mintToken(ERASE_AUTH_ID);
const limitToken = mintToken(LIMIT_AUTH_ID);

const json = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...extra,
});

/** The phone deliberately reused across two profiles, to test the lookup digest. */
const SHARED_PHONE = `+9198${String(RUN).slice(-8)}`;
const SUBJECT_DOB = '1958-04-12';

const sql = postgres(CORE_DATABASE_URL);

// ── Preflight ────────────────────────────────────────────────────────────────

try {
  const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (err) {
  console.error(`Service not reachable at ${BASE} — start it first.\n  ${err}`);
  await sql.end();
  process.exit(1);
}

for (const [authId, name] of [
  [SUBJECT_AUTH_ID, 'Subject'],
  [OTHER_AUTH_ID, 'Other'],
  [ERASE_AUTH_ID, 'Erasable'],
  [LIMIT_AUTH_ID, 'Limited'],
] as const) {
  await sql`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (
      ${authId}::uuid,
      ${`compliance-${name.toLowerCase()}-${RUN}@longeny.test`},
      ${name},
      'Compliance'
    )
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

const accountIdOf = async (authId: string): Promise<string> => {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE auth_id = ${authId}::uuid LIMIT 1
  `;
  return row.id;
};

const SUBJECT_USER_ID = await accountIdOf(SUBJECT_AUTH_ID);
const OTHER_USER_ID = await accountIdOf(OTHER_AUTH_ID);
const ERASE_USER_ID = await accountIdOf(ERASE_AUTH_ID);

// ── 1. Encryption at rest (H1) ───────────────────────────────────────────────
// The response cannot show this. `phone_hash` used to hold the phone number
// itself, sitting beside its own ciphertext — the encryption was real and the
// column next to it undid it.

console.log('\n1. Phone and date of birth are ciphertext at rest, with a keyed lookup digest (H1)');

let r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: json(subjectToken),
    body: JSON.stringify({
      relation: 'father',
      firstName: 'Ramesh',
      lastName: `Subject-${RUN}`,
      email: `ramesh-${RUN}@example.com`,
      phone: SHARED_PHONE,
      dateOfBirth: SUBJECT_DOB,
      gender: 'male',
      goal: 'Reverse type-2 diabetes',
    }),
  }),
);
check('201 Created', r.status === 201, r.body);
const dependentId = String(record(envelope(r.body).data).id ?? '');
const createResponseText = r.text;

// A second profile with the SAME phone. Deterministic lookup means the digests
// must match; semantic security means the ciphertexts must not.
r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: json(subjectToken),
    body: JSON.stringify({
      relation: 'mother',
      firstName: 'Sunita',
      lastName: `Subject-${RUN}`,
      phone: SHARED_PHONE,
      dateOfBirth: '1961-09-03',
    }),
  }),
);
check('201 Created for a second profile sharing the phone', r.status === 201, r.body);
const siblingId = String(record(envelope(r.body).data).id ?? '');

interface StoredProfile {
  id: string;
  phone_encrypted: string | null;
  phone_hash: string | null;
  date_of_birth_encrypted: string | null;
}

const stored = await sql<StoredProfile[]>`
  SELECT id, phone_encrypted, phone_hash, date_of_birth_encrypted
  FROM profiles WHERE id IN (${dependentId}::uuid, ${siblingId}::uuid)
`;
const dependentRow = stored.find((row) => row.id === dependentId);
const siblingRow = stored.find((row) => row.id === siblingId);

check('both rows are in the database', Boolean(dependentRow && siblingRow), stored.length);
check(
  'phone_encrypted does not contain the phone number',
  Boolean(dependentRow?.phone_encrypted) && !dependentRow?.phone_encrypted?.includes(SHARED_PHONE),
  dependentRow?.phone_encrypted,
);
check(
  'phone_encrypted does not contain the digits either (unformatted match)',
  !dependentRow?.phone_encrypted?.includes(SHARED_PHONE.replace('+', '')),
  dependentRow?.phone_encrypted,
);
check(
  'date_of_birth_encrypted does not contain the date of birth',
  Boolean(dependentRow?.date_of_birth_encrypted) &&
    !dependentRow?.date_of_birth_encrypted?.includes(SUBJECT_DOB) &&
    !dependentRow?.date_of_birth_encrypted?.includes('1958'),
  dependentRow?.date_of_birth_encrypted,
);
check(
  'phone_hash is a 64-hex digest, not the phone number',
  HEX64.test(String(dependentRow?.phone_hash)) && dependentRow?.phone_hash !== SHARED_PHONE,
  dependentRow?.phone_hash,
);
check(
  'the same phone hashes to the same digest on the second profile (deterministic lookup)',
  Boolean(dependentRow?.phone_hash) && dependentRow?.phone_hash === siblingRow?.phone_hash,
  { first: dependentRow?.phone_hash, second: siblingRow?.phone_hash },
);
check(
  'but the two ciphertexts differ (a random IV per row, not ECB)',
  Boolean(dependentRow?.phone_encrypted) &&
    dependentRow?.phone_encrypted !== siblingRow?.phone_encrypted,
  { first: dependentRow?.phone_encrypted, second: siblingRow?.phone_encrypted },
);
check(
  'the digest is keyed, not a bare SHA-256 of the number',
  dependentRow?.phone_hash !== sha256(SHARED_PHONE),
  { stored: dependentRow?.phone_hash, unkeyed: sha256(SHARED_PHONE) },
);

// The notification destination is the same defect class — check it too.
r = await call(
  await fetch(`${BASE}/profiles/${dependentId}/notification-targets`, {
    method: 'POST',
    headers: json(subjectToken),
    body: JSON.stringify({ channel: 'sms', destination: SHARED_PHONE }),
  }),
);
check('201 — notification target created', r.status === 201, r.body);

const storedTargets = await sql<
  Array<{ destination_encrypted: string; destination_hash: string | null }>
>`
  SELECT destination_encrypted, destination_hash
  FROM notification_targets WHERE profile_id = ${dependentId}::uuid
`;
check(
  'destination_encrypted is ciphertext and destination_hash is a keyed digest',
  storedTargets.length === 1 &&
    !storedTargets[0].destination_encrypted.includes(SHARED_PHONE) &&
    HEX64.test(String(storedTargets[0].destination_hash)) &&
    storedTargets[0].destination_hash !== SHARED_PHONE,
  storedTargets[0],
);

// ── 2. No PII in responses ───────────────────────────────────────────────────

console.log('\n2. No API response carries the encrypted columns, the digest, or the raw phone');

const responsesToScan: Array<[string, string]> = [['POST /profiles', createResponseText]];

r = await call(await fetch(`${BASE}/profiles/${dependentId}`, { headers: json(subjectToken) }));
check('200 — read one profile', r.status === 200, r.status);
responsesToScan.push(['GET /profiles/:id', r.text]);

r = await call(await fetch(`${BASE}/profiles`, { headers: json(subjectToken) }));
check('200 — list profiles', r.status === 200, r.status);
responsesToScan.push(['GET /profiles', r.text]);

r = await call(
  await fetch(`${BASE}/profiles/${dependentId}/notification-targets`, {
    headers: json(subjectToken),
  }),
);
responsesToScan.push(['GET /profiles/:id/notification-targets', r.text]);

const LEAKED_TOKENS = [
  'phone_encrypted',
  'phone_hash',
  'date_of_birth_encrypted',
  'destination_encrypted',
  'destination_hash',
  SHARED_PHONE,
  SUBJECT_DOB,
  String(dependentRow?.phone_hash),
  String(dependentRow?.phone_encrypted),
];

for (const [label, text] of responsesToScan) {
  const found = LEAKED_TOKENS.filter((needle) => needle.length > 3 && text.includes(needle));
  check(`${label} leaks none of the encrypted columns, the hash or the phone`, found.length === 0, {
    found,
  });
}

r = await call(await fetch(`${BASE}/profiles/${dependentId}`, { headers: json(subjectToken) }));
check(
  'the response says has_phone / has_date_of_birth instead',
  record(envelope(r.body).data).has_phone === true &&
    record(envelope(r.body).data).has_date_of_birth === true,
  envelope(r.body).data,
);

// ── 3. PHI audit trail (C2) ──────────────────────────────────────────────────
// A successful read, a 403 and a 404, each attributed to the account that
// actually made the request. Under C1/C2 the actor came from a store shared by
// every in-flight request, so a denial could be filed against the victim.

console.log('\n3. Every read and every denial lands in phi_access_log, attributed correctly');

interface AuditRow {
  actor_id: string;
  profile_id: string | null;
  status_code: number;
  success: boolean;
  method: string;
  path: string;
}

const auditRowsFor = (correlationId: string) =>
  waitFor(
    () => sql<AuditRow[]>`
      SELECT actor_id, profile_id, status_code, success, method, path
      FROM phi_access_log WHERE correlation_id = ${correlationId}
    `,
    (found) => found.length >= 1,
  );

const readCorrelation = `cmp-read-${RUN}`;
r = await call(
  await fetch(`${BASE}/profiles/${dependentId}`, {
    headers: json(subjectToken, { 'X-Correlation-ID': readCorrelation }),
  }),
);
check('200 — a successful read', r.status === 200, r.status);
let auditRows = await auditRowsFor(readCorrelation);
check(
  'one row, actor = the subject account, status 200, success true',
  auditRows.length === 1 &&
    auditRows[0].actor_id === SUBJECT_AUTH_ID &&
    auditRows[0].status_code === 200 &&
    auditRows[0].success === true,
  auditRows,
);
check(
  'and it names the profile that was read',
  auditRows[0]?.profile_id === dependentId,
  auditRows[0],
);

const forbiddenCorrelation = `cmp-403-${RUN}`;
const noPermissionToken = mintToken(SUBJECT_AUTH_ID, { permissions: ['users:read'] });
r = await call(
  await fetch(`${BASE}/profiles`, {
    headers: json(noPermissionToken, { 'X-Correlation-ID': forbiddenCorrelation }),
  }),
);
check('403 — authenticated but without profiles:read', r.status === 403, r.status);
auditRows = await auditRowsFor(forbiddenCorrelation);
check(
  'the denial is recorded: actor = the subject account, status 403, success false',
  auditRows.length === 1 &&
    auditRows[0].actor_id === SUBJECT_AUTH_ID &&
    auditRows[0].status_code === 403 &&
    auditRows[0].success === false,
  auditRows,
);

const notFoundCorrelation = `cmp-404-${RUN}`;
r = await call(
  await fetch(`${BASE}/profiles/${dependentId}`, {
    headers: json(otherToken, { 'X-Correlation-ID': notFoundCorrelation }),
  }),
);
check('404 — a different account reaching for this profile', r.status === 404, r.status);
auditRows = await auditRowsFor(notFoundCorrelation);
check(
  'the row names the account that reached, not the account that owns the data',
  auditRows.length === 1 &&
    auditRows[0].actor_id === OTHER_AUTH_ID &&
    auditRows[0].actor_id !== SUBJECT_AUTH_ID &&
    auditRows[0].status_code === 404 &&
    auditRows[0].success === false,
  auditRows,
);

const anonymousCorrelation = `cmp-401-${RUN}`;
r = await call(
  await fetch(`${BASE}/profiles`, { headers: { 'X-Correlation-ID': anonymousCorrelation } }),
);
check('401 — no token at all', r.status === 401, r.status);
auditRows = await auditRowsFor(anonymousCorrelation);
check(
  'an unauthenticated attempt is filed as anonymous, never as a real account',
  auditRows.length === 1 &&
    auditRows[0].actor_id === 'anonymous' &&
    auditRows[0].status_code === 401 &&
    auditRows[0].success === false,
  auditRows,
);

// ── 4. The audit tables are append-only in the database (M3) ─────────────────
// Documented as append-only is not the same as being append-only. These
// statements are issued directly, as the service's own database role, bypassing
// every application guard — which is precisely the threat the trigger answers.

console.log('\n4. phi_access_log and caregiver_consent_audit reject UPDATE and DELETE (M3)');

const [{ id: auditRowId }] = await sql<Array<{ id: string }>>`
  SELECT id FROM phi_access_log WHERE correlation_id = ${readCorrelation} LIMIT 1
`;

async function expectRejected(label: string, statement: () => Promise<unknown>): Promise<void> {
  try {
    await statement();
    check(label, false, 'the statement succeeded — the table is mutable');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, /append-only|insufficient_privilege|not permitted/i.test(message), message);
  }
}

await expectRejected(
  'UPDATE on phi_access_log is rejected by the database',
  () => sql`UPDATE phi_access_log SET success = false WHERE id = ${auditRowId}::uuid`,
);
await expectRejected(
  'DELETE on phi_access_log is rejected by the database',
  () => sql`DELETE FROM phi_access_log WHERE id = ${auditRowId}::uuid`,
);

// The row is still there, unchanged — the rejection was not a partial write.
const survivor = await sql<AuditRow[]>`
  SELECT actor_id, profile_id, status_code, success, method, path
  FROM phi_access_log WHERE id = ${auditRowId}::uuid
`;
check(
  'the row survived both attempts with its original values',
  survivor.length === 1 && survivor[0].success === true && survivor[0].status_code === 200,
  survivor,
);

// caregiver_consent_audit carries the proof that consent was lawful, so it is
// held to the same rule. Granting consent writes a row to it.
r = await call(
  await fetch(`${BASE}/profiles/${dependentId}/consent`, {
    method: 'POST',
    headers: json(subjectToken),
    body: JSON.stringify({
      consentType: 'health_data',
      status: 'granted',
      notes: `signed ${RUN}`,
    }),
  }),
);
check('201 — consent granted', r.status === 201, r.body);

const consentAuditRows = await waitFor(
  () => sql<Array<{ id: string }>>`
    SELECT id FROM caregiver_consent_audit WHERE profile_id = ${dependentId}::uuid
  `,
  (found) => found.length >= 1,
);
check('granting consent wrote a caregiver_consent_audit row', consentAuditRows.length >= 1, {
  count: consentAuditRows.length,
});

await expectRejected(
  'UPDATE on caregiver_consent_audit is rejected by the database',
  () =>
    sql`UPDATE caregiver_consent_audit SET action = 'revoked' WHERE id = ${consentAuditRows[0].id}::uuid`,
);
await expectRejected(
  'DELETE on caregiver_consent_audit is rejected by the database',
  () => sql`DELETE FROM caregiver_consent_audit WHERE id = ${consentAuditRows[0].id}::uuid`,
);

// ── 5. GDPR export (M1) ──────────────────────────────────────────────────────
// The seven profile-scoped tables have no foreign key back to the account, so
// nothing about them follows from exporting the account. A dependent parent has
// no login of their own; if their row is missed here, nobody can ask for it.

console.log('\n5. The export carries every profile-scoped table, decrypted, without the digests');

// An RRO transition, recorded the way the AI classifier records one.
{
  const path = '/internal/rro-state/transition';
  const body = JSON.stringify({
    profileId: dependentId,
    toState: 'reverse',
    reason: 'AI classifier: metabolic dysfunction',
    source: 'ai_classifier',
  });
  r = await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('ai-content-service', 'POST', path, body),
      body,
    }),
  );
  check('200 — RRO transition recorded via the internal route', r.status === 200, r.body);
}

// A notification to the dependent, which writes the notification log.
{
  const path = '/internal/notify/profile';
  const body = JSON.stringify({
    profileId: dependentId,
    channel: 'sms',
    subject: 'Check-in',
    body: 'Time for your weekly check-in',
  });
  r = await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('test-suite', 'POST', path, body),
      body,
    }),
  );
  check('200 — notification queued to the dependent', r.status === 200, r.body);
}

// Onboarding for TWO profiles. The export used to return one row and silently
// drop the rest, which is the whole reason this is asserted per profile.
const selfProfileId = String(
  rows(
    envelope((await call(await fetch(`${BASE}/profiles`, { headers: json(subjectToken) }))).body)
      .data,
  ).find((p) => p.is_self === true)?.id ?? '',
);
check('the account has a self profile', selfProfileId.length > 0, selfProfileId);

/**
 * DEFECT (open, environment): the live `longeny_core` schema still carries the
 * account-wide `onboarding_state_user_id_unique` constraint. db/schema.ts
 * replaced it with `onboarding_state_user_profile_unique (user_id, profile_id)`
 * and migration 0001_onboarding_state_per_profile.sql performs the swap, but the
 * database was built with `drizzle-kit push` and has no rows in
 * `drizzle.__drizzle_migrations` — push added 0002's column and left the old
 * constraint standing. The effect is not cosmetic: the SECOND profile's first
 * onboarding save violates the constraint and answers 500, so an account can
 * hold exactly one intake no matter how many subjects of care it has, and the
 * M1 fix below ("export returns onboarding state for every profile") can never
 * be satisfied because the rows cannot be written in the first place.
 *
 * Fix:
 *   docker exec -i w7pg psql -U longeny -d longeny_core \
 *     < apps/user-provider-service/src/db/migrations/0001_onboarding_state_per_profile.sql
 *
 * Left failing on purpose until that runs.
 */
const onboardingConstraints = await sql<Array<{ conname: string }>>`
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'onboarding_state'::regclass AND contype = 'u'
`;

for (const [profileId, label] of [
  [selfProfileId, 'self'],
  [dependentId, 'dependent'],
] as const) {
  const res = await call(
    await fetch(`${BASE}/users/me/onboarding`, {
      method: 'POST',
      headers: json(subjectToken, { 'X-Active-Profile-Id': profileId }),
      body: JSON.stringify({ step: 1, data: { subject: label, run: RUN } }),
    }),
  );
  check(`onboarding step saved for the ${label} profile`, res.status === 200, {
    status: res.status,
    body: res.body,
    uniqueConstraintsOnOnboardingState: onboardingConstraints.map((c) => c.conname),
    expected: 'onboarding_state_user_profile_unique',
  });
}

const exportRes = await call(
  await fetch(`${BASE}/users/me/data-export/portable`, {
    method: 'POST',
    headers: json(subjectToken),
    body: JSON.stringify({}),
  }),
);
check('200 — portable export', exportRes.status === 200, exportRes.status);
const exported = record(envelope(exportRes.body).data);

check(
  'the profiles themselves are in the export',
  rows(exported.profiles).length >= 3,
  rows(exported.profiles).length,
);
check(
  'consent is in the export',
  rows(exported.caregiverConsents).some((c) => c.profile_id === dependentId),
  exported.caregiverConsents,
);
check(
  'the notification target is in the export',
  rows(exported.notificationTargets).some((t) => t.profile_id === dependentId),
  exported.notificationTargets,
);
check(
  'the notification log is in the export',
  rows(exported.notificationLog).some((n) => n.profile_id === dependentId),
  rows(exported.notificationLog).length,
);
check(
  'the RRO state is in the export',
  rows(exported.rroStates).some((s) => s.profile_id === dependentId),
  exported.rroStates,
);
check(
  'the RRO transition is in the export',
  rows(exported.rroTransitions).some(
    (t) => t.profile_id === dependentId && t.to_state === 'reverse',
  ),
  rows(exported.rroTransitions).length,
);

const exportedOnboarding = rows(exported.onboardingStates);
const onboardingProfileIds = new Set(exportedOnboarding.map((o) => String(o.profile_id)));
// Blocked by the same constraint drift as above: the dependent's row does not
// exist to be exported. The export code itself is correct — it selects every
// row for the account rather than LIMIT 1 — but this is the assertion that would
// catch a regression back to one row per account, so it stays.
check(
  'onboarding state is returned for EVERY profile, not one (M1)',
  onboardingProfileIds.has(selfProfileId) && onboardingProfileIds.has(dependentId),
  {
    returnedFor: [...onboardingProfileIds],
    expected: [selfProfileId, dependentId],
    cause: 'see the onboarding_state_user_id_unique note above',
  },
);

// The subject is entitled to their own PII in plaintext...
const exportedDependent = rows(exported.profiles).find((p) => p.id === dependentId);
check(
  'the subject’s own phone comes back decrypted',
  exportedDependent?.phone === SHARED_PHONE,
  exportedDependent?.phone,
);
check(
  'and so does the date of birth',
  String(exportedDependent?.dateOfBirth ?? '').startsWith(SUBJECT_DOB),
  exportedDependent?.dateOfBirth,
);
check(
  'the notification destination comes back decrypted too',
  rows(exported.notificationTargets).some((t) => t.destination === SHARED_PHONE),
  rows(exported.notificationTargets).map((t) => t.destination),
);

// ...but not our correlation keys, which are ours and not personal data.
const exportKeys = deepKeys(exported);
const leakedHashKeys = exportKeys.filter((k) => k.endsWith('_hash'));
check('no *_hash column appears anywhere in the export', leakedHashKeys.length === 0, [
  ...new Set(leakedHashKeys),
]);
const leakedCipherKeys = exportKeys.filter((k) => k.endsWith('_encrypted'));
check('no *_encrypted blob is handed back raw either', leakedCipherKeys.length === 0, [
  ...new Set(leakedCipherKeys),
]);
check(
  'and the stored digest value itself is nowhere in the export',
  !deepStrings(exported).includes(String(dependentRow?.phone_hash)),
  dependentRow?.phone_hash,
);

// ── 6. GDPR erasure (M1) ─────────────────────────────────────────────────────
// A separate account, built for this and destroyed by it. The access log must
// outlive the erasure: it is the record that the erasure happened, and deleting
// it would destroy the evidence along with the data.

console.log('\n6. Erasure empties every profile-scoped table and leaves the audit trail intact');

r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: json(eraseToken),
    body: JSON.stringify({
      relation: 'mother',
      firstName: 'Erasable',
      lastName: `Dependent-${RUN}`,
      phone: `+9197${String(RUN).slice(-8)}`,
      dateOfBirth: '1955-01-01',
    }),
  }),
);
check('201 — dependent profile created on the erasable account', r.status === 201, r.body);
const erasableDependentId = String(record(envelope(r.body).data).id ?? '');

await call(
  await fetch(`${BASE}/profiles/${erasableDependentId}/consent`, {
    method: 'POST',
    headers: json(eraseToken),
    body: JSON.stringify({ consentType: 'health_data', status: 'granted' }),
  }),
);
await call(
  await fetch(`${BASE}/profiles/${erasableDependentId}/notification-targets`, {
    method: 'POST',
    headers: json(eraseToken),
    body: JSON.stringify({ channel: 'sms', destination: `+9196${String(RUN).slice(-8)}` }),
  }),
);
{
  const path = '/internal/rro-state/transition';
  const body = JSON.stringify({
    profileId: erasableDependentId,
    toState: 'restore',
    reason: 'clinician',
    source: 'clinician',
  });
  await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('test-suite', 'POST', path, body),
      body,
    }),
  );
}
{
  const path = '/internal/notify/profile';
  const body = JSON.stringify({
    profileId: erasableDependentId,
    channel: 'sms',
    subject: 'Check-in',
    body: 'weekly',
  });
  await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('test-suite', 'POST', path, body),
      body,
    }),
  );
}

// Health data, written as the dependent — the rows that a profile-blind erasure
// leaves behind.
const eraseHeaders = json(eraseToken, { 'X-Active-Profile-Id': erasableDependentId });
// Onboarding is written as the SELF profile here on purpose: the dependent's row
// cannot be written while the constraint drift noted in §5 stands, and this
// section must test erasure rather than re-fail that.
const erasableOnboarding = await call(
  await fetch(`${BASE}/users/me/onboarding`, {
    method: 'POST',
    headers: json(eraseToken),
    body: JSON.stringify({ step: 1, data: { note: 'intake' } }),
  }),
);
check('onboarding recorded on the erasable account', erasableOnboarding.status === 200, {
  status: erasableOnboarding.status,
});
await call(
  await fetch(`${BASE}/users/me/health-profile`, {
    method: 'PUT',
    headers: json(eraseToken),
    body: JSON.stringify({ heightCm: 165, weightKg: 70, bloodType: 'O+' }),
  }),
);
await call(
  await fetch(`${BASE}/progress/entries`, {
    method: 'POST',
    headers: eraseHeaders,
    body: JSON.stringify({ metricType: 'weight', value: 70, unit: 'kg' }),
  }),
);
const habitRes = await call(
  await fetch(`${BASE}/progress/habits`, {
    method: 'POST',
    headers: eraseHeaders,
    body: JSON.stringify({ name: `Walk-${RUN}`, frequency: 'DAILY', targetCount: 1 }),
  }),
);
const erasableHabitId = String(record(envelope(habitRes.body).data).id ?? '');
if (erasableHabitId) {
  await call(
    await fetch(`${BASE}/progress/habits/${erasableHabitId}/checkin`, {
      method: 'POST',
      headers: eraseHeaders,
      body: JSON.stringify({}),
    }),
  );
}
await call(
  await fetch(`${BASE}/progress/goals`, {
    method: 'POST',
    headers: eraseHeaders,
    body: JSON.stringify({
      title: `Goal-${RUN}`,
      targetValue: 65,
      unit: 'kg',
      startDate: new Date().toISOString().slice(0, 10),
    }),
  }),
);

const erasableProfileIds = (
  await sql<Array<{ id: string }>>`
    SELECT id FROM profiles WHERE account_user_id = ${ERASE_USER_ID}::uuid
  `
).map((row) => row.id);
check('the erasable account owns more than one profile', erasableProfileIds.length >= 2, {
  count: erasableProfileIds.length,
});

/** Rows that belong to this account, whichever id shape the writer used. */
const countScoped = async (table: string): Promise<number> => {
  const [row] = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM ${sql(table)}
    WHERE profile_id = ANY(${erasableProfileIds}::uuid[])
       OR user_id IN (${ERASE_USER_ID}::uuid, ${ERASE_AUTH_ID}::uuid)
  `;
  return Number(row.count);
};

const PROFILE_SCOPED_TABLES = [
  'caregiver_consent',
  'rro_state',
  'rro_transition',
  'notification_targets',
  'notification_log',
];
const HEALTH_TABLES = [
  'onboarding_state',
  'health_profiles',
  'progress_entries',
  'habits',
  'habit_checkins',
  'goals',
];

const before: Record<string, number> = {};
for (const table of PROFILE_SCOPED_TABLES) {
  const [row] = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM ${sql(table)}
    WHERE profile_id = ANY(${erasableProfileIds}::uuid[])
  `;
  before[table] = Number(row.count);
}
for (const table of HEALTH_TABLES) before[table] = await countScoped(table);

check(
  'every table under test actually holds data before the erasure (a meaningful test)',
  Object.entries(before).every(([, count]) => count > 0),
  before,
);

// The audit tables must come through untouched. Scoped to this account so a
// suite running alongside cannot move the number.
const auditCountBefore = Number(
  (
    await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM phi_access_log WHERE actor_id = ${ERASE_AUTH_ID}
    `
  )[0].count,
);
const consentAuditCountBefore = Number(
  (
    await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM caregiver_consent_audit
      WHERE profile_id = ANY(${erasableProfileIds}::uuid[])
    `
  )[0].count,
);
check('the erasable account has access-log rows to preserve', auditCountBefore > 0, {
  auditCountBefore,
});
check('and consent-audit rows to preserve', consentAuditCountBefore > 0, {
  consentAuditCountBefore,
});

{
  const path = `/internal/gdpr/user-data/${ERASE_USER_ID}`;
  r = await call(
    await fetch(`${BASE}${path}`, {
      method: 'DELETE',
      headers: hmacHeaders('test-suite', 'DELETE', path, ''),
    }),
  );
  check('200 — erasure executed', r.status === 200, r.body);
}

const leftBehind: Record<string, number> = {};
for (const table of PROFILE_SCOPED_TABLES) {
  const [row] = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count FROM ${sql(table)}
    WHERE profile_id = ANY(${erasableProfileIds}::uuid[])
  `;
  leftBehind[table] = Number(row.count);
}
for (const table of HEALTH_TABLES) leftBehind[table] = await countScoped(table);
const [profilesLeft] = await sql<Array<{ count: string }>>`
  SELECT COUNT(*)::text AS count FROM profiles WHERE account_user_id = ${ERASE_USER_ID}::uuid
`;
leftBehind.profiles = Number(profilesLeft.count);

for (const [table, count] of Object.entries(leftBehind)) {
  check(`${table} is empty for the erased account`, count === 0, { rowsLeft: count });
}

const anonymised = await sql<
  Array<{ email: string; first_name: string; phone_hash: string | null; status: string }>
>`
  SELECT email, first_name, phone_hash, status FROM users WHERE id = ${ERASE_USER_ID}::uuid
`;
check(
  'the users row is anonymised and deactivated rather than deleted',
  anonymised.length === 1 &&
    anonymised[0].email.includes('erased') &&
    anonymised[0].first_name === 'Deleted' &&
    anonymised[0].phone_hash === null &&
    anonymised[0].status === 'deactivated',
  anonymised[0],
);

const auditCountAfter = Number(
  (
    await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM phi_access_log WHERE actor_id = ${ERASE_AUTH_ID}
    `
  )[0].count,
);
const consentAuditCountAfter = Number(
  (
    await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM caregiver_consent_audit
      WHERE profile_id = ANY(${erasableProfileIds}::uuid[])
    `
  )[0].count,
);
check(
  'phi_access_log is unchanged by the erasure — the access record survives it',
  auditCountAfter === auditCountBefore,
  { before: auditCountBefore, after: auditCountAfter },
);
check(
  'caregiver_consent_audit is unchanged too — the proof consent was lawful survives',
  consentAuditCountAfter === consentAuditCountBefore,
  { before: consentAuditCountBefore, after: consentAuditCountAfter },
);

// ── 7. Rate limiting is per account ──────────────────────────────────────────
// Per IP would let one family behind a shared address exhaust everyone's budget,
// and would let one account escape its own by reconnecting.

console.log('\n7. The profile rate limit is charged to the account, not the address');

const RATE_LIMIT_KEY = `ratelimit:profiles:account:${LIMIT_AUTH_ID}`;
const CONTROL_KEY = `ratelimit:profiles:account:${OTHER_AUTH_ID}`;
const clearBudget = async () => {
  await Bun.$`docker exec w7redis redis-cli DEL ${RATE_LIMIT_KEY} ${CONTROL_KEY}`.quiet();
};
await clearBudget();

let limitedAt = -1;
let firstLimitedBody: unknown = null;
for (let i = 1; i <= 200 && limitedAt < 0; i++) {
  const res = await call(await fetch(`${BASE}/profiles`, { headers: json(limitToken) }));
  if (res.status === 429) {
    limitedAt = i;
    firstLimitedBody = res.body;
  }
}
check('the account is eventually refused with 429', limitedAt > 0, { limitedAt });
check('and only after a real budget, not on the first request', limitedAt > 10, { limitedAt });
check(
  'the refusal is a rate-limit error, not a generic failure',
  String(envelope(firstLimitedBody).error?.code ?? '').includes('RATE'),
  firstLimitedBody,
);

// The second account is in the same window, from the same address.
const control = await call(await fetch(`${BASE}/profiles`, { headers: json(otherToken) }));
check(
  'a second account in the same window from the same address is unaffected',
  control.status === 200,
  control.status,
);

const exhaustedAgain = await call(await fetch(`${BASE}/profiles`, { headers: json(limitToken) }));
check(
  'while the limited account is still refused (the budget is not shared)',
  exhaustedAgain.status === 429,
  exhaustedAgain.status,
);

// Leave Redis as we found it: a 60-second window would otherwise poison whatever
// runs next against these accounts.
await clearBudget();
const remainingKeys = await Bun.$`docker exec w7redis redis-cli EXISTS ${RATE_LIMIT_KEY}`.text();
check('the rate-limit keys were cleaned up', remainingKeys.trim() === '0', remainingKeys.trim());

// ── 8. Identity under concurrency (C1/C2) ────────────────────────────────────
// This is the regression guard for the critical finding. Every check above
// passes against a build that leaks between accounts, because a serial suite is
// the one ordering in which the bug cannot appear.

console.log('\n8. Interleaved requests from two accounts keep their own identity (C1/C2)');

const subjectList = await call(await fetch(`${BASE}/profiles`, { headers: json(subjectToken) }));
const otherList = await call(await fetch(`${BASE}/profiles`, { headers: json(otherToken) }));
const subjectCount = rows(envelope(subjectList.body).data).length;
const otherCount = rows(envelope(otherList.body).data).length;
check(
  'the two accounts hold different numbers of profiles (a meaningful test)',
  subjectCount !== otherCount,
  {
    subjectCount,
    otherCount,
  },
);

const concurrentCorrelation = `cmp-conc-${RUN}`;
const interleaved = await Promise.all(
  Array.from({ length: 10 }, (_unused, i) => {
    const isSubject = i % 2 === 0;
    const token = isSubject ? subjectToken : otherToken;
    return fetch(`${BASE}/profiles`, {
      headers: json(token, { 'X-Correlation-ID': `${concurrentCorrelation}-${i}` }),
    })
      .then(call)
      .then((res) => ({ index: i, isSubject, res }));
  }),
);

const wrongAccount = interleaved.filter(({ isSubject, res }) => {
  const returned = rows(envelope(res.body).data);
  const expectedOwner = isSubject ? SUBJECT_USER_ID : OTHER_USER_ID;
  return res.status !== 200 || returned.some((p) => p.account_user_id !== expectedOwner);
});
check(
  'all 10 interleaved responses carried the calling account’s own data',
  wrongAccount.length === 0,
  wrongAccount.map(({ index, isSubject, res }) => ({
    index,
    expected: isSubject ? SUBJECT_USER_ID : OTHER_USER_ID,
    status: res.status,
    owners: [...new Set(rows(envelope(res.body).data).map((p) => p.account_user_id))],
  })),
);

const concurrentAudit = await waitFor(
  () => sql<Array<{ actor_id: string; correlation_id: string }>>`
    SELECT actor_id, correlation_id FROM phi_access_log
    WHERE correlation_id LIKE ${`${concurrentCorrelation}-%`}
  `,
  (found) => found.length >= 10,
);
check('all 10 requests were audited', concurrentAudit.length === 10, concurrentAudit.length);

const misattributed = concurrentAudit.filter((row) => {
  const index = Number(row.correlation_id.slice(concurrentCorrelation.length + 1));
  const expected = index % 2 === 0 ? SUBJECT_AUTH_ID : OTHER_AUTH_ID;
  return row.actor_id !== expected;
});
check(
  'and phi_access_log attributed every one of them to the account that made it',
  misattributed.length === 0,
  misattributed,
);
check(
  'both accounts appear in the log — 5 rows each, not 10 under one',
  concurrentAudit.filter((row) => row.actor_id === SUBJECT_AUTH_ID).length === 5 &&
    concurrentAudit.filter((row) => row.actor_id === OTHER_AUTH_ID).length === 5,
  {
    subject: concurrentAudit.filter((row) => row.actor_id === SUBJECT_AUTH_ID).length,
    other: concurrentAudit.filter((row) => row.actor_id === OTHER_AUTH_ID).length,
  },
);

// ── Teardown ─────────────────────────────────────────────────────────────────
// The four accounts this run created, and nothing else. phi_access_log and
// caregiver_consent_audit are append-only and are deliberately left alone: they
// are the record that these requests happened, and §4 just proved they cannot be
// deleted anyway.

console.log('\nTeardown');

const createdAccountIds = [
  SUBJECT_USER_ID,
  OTHER_USER_ID,
  ERASE_USER_ID,
  await accountIdOf(LIMIT_AUTH_ID),
];
const createdProfileIds = (
  await sql<Array<{ id: string }>>`
    SELECT id FROM profiles WHERE account_user_id = ANY(${createdAccountIds}::uuid[])
  `
).map((row) => row.id);

if (createdProfileIds.length > 0) {
  for (const table of [
    'notification_log',
    'notification_targets',
    'rro_transition',
    'rro_state',
    'caregiver_consent',
  ]) {
    await sql`DELETE FROM ${sql(table)} WHERE profile_id = ANY(${createdProfileIds}::uuid[])`;
  }
  for (const table of HEALTH_TABLES) {
    await sql`
      DELETE FROM ${sql(table)}
      WHERE profile_id = ANY(${createdProfileIds}::uuid[])
         OR user_id = ANY(${[...createdAccountIds, SUBJECT_AUTH_ID, OTHER_AUTH_ID, ERASE_AUTH_ID, LIMIT_AUTH_ID]}::uuid[])
    `;
  }
  await sql`DELETE FROM profiles WHERE id = ANY(${createdProfileIds}::uuid[])`;
}
await sql`DELETE FROM data_export_requests WHERE user_id = ANY(${createdAccountIds}::uuid[])`;
await sql`DELETE FROM user_preferences WHERE user_id = ANY(${createdAccountIds}::uuid[])`;
await sql`DELETE FROM user_profiles WHERE user_id = ANY(${createdAccountIds}::uuid[])`;
await sql`DELETE FROM users WHERE id = ANY(${createdAccountIds}::uuid[])`;
await sql.end();

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
