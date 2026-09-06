/**
 * End-to-end tests for RRO intake and onboarding-session ownership (Week 7,
 * cards W7-1, W7-3, W7-4).
 *
 * Real services, real PostgreSQL, real Redis — no mocks. Requires:
 *   1. Postgres + Redis up, both `longeny_core` and `longeny_ai_content` migrated
 *   2. user-provider-service on :3002 (it answers the ownership question)
 *   3. ai-content-service on :3004
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/ai-content-service/test/intake-rro.e2e.ts
 *
 * Every write is confirmed against the database rather than against the
 * response, because a handler that answers 201 and stores the row under the
 * wrong profile is exactly the failure these tests exist to catch.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3004';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

// Namespaced per run so the suite can run twice in a row without cleanup.
const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();
const OTHER_AUTH_ID = crypto.randomUUID();

const USER_PERMISSIONS = [
  'profiles:read',
  'profiles:write',
  'consent:grant',
  'intake:read',
  'intake:write',
  'rro:read',
  'users:read',
  'progress:read',
];

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: `w7-${RUN}@longeny.test`,
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

const authHeaders = {
  Authorization: `Bearer ${mintToken()}`,
  'Content-Type': 'application/json',
};

const otherAccountHeaders = {
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: `w7-other-${RUN}@longeny.test` })}`,
  'Content-Type': 'application/json',
};

/** Authenticated, but holds no intake permission. */
const noPermissionHeaders = {
  Authorization: `Bearer ${mintToken({ permissions: ['users:read'] })}`,
  'Content-Type': 'application/json',
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

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
] as const) {
  try {
    const health = await fetch(url);
    if (!health.ok) throw new Error(`health returned ${health.status}`);
  } catch (err) {
    console.error(`${name} not reachable at ${url} — start it first.\n  ${err}`);
    process.exit(1);
  }
}

// ── Fixtures: two real accounts ──────────────────────────────────────────────
// A foreign token whose account does not exist 404s because the *account* is
// missing, which would pass every cross-tenant check below for the wrong reason.

const core = postgres(process.env.CORE_DATABASE_URL as string);
const ai = postgres(process.env.AI_CONTENT_DATABASE_URL as string);

for (const [authId, label] of [
  [AUTH_ID, 'own'],
  [OTHER_AUTH_ID, 'other'],
] as const) {
  await core`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (${authId}::uuid, ${`w7-${label}-${RUN}@longeny.test`}, ${`W7${label}`}, 'Test')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

// ── 1. Profile resolution over HMAC (W7-1) ───────────────────────────────────

console.log('\n1. POST /internal/profiles/resolve — the ownership question, asked by a service');

let r = await call(await fetch(`${USER_PROVIDER}/profiles`, { headers: authHeaders }));
check('own account lists its profiles', r.status === 200, r);
const selfId: string = r.body.data?.find((p: any) => p.is_self)?.id;
check('self profile exists', Boolean(selfId), r.body.data);

r = await call(await fetch(`${USER_PROVIDER}/profiles`, { headers: otherAccountHeaders }));
const otherSelfId: string = r.body.data?.find((p: any) => p.is_self)?.id;
check('second account has its own self profile', Boolean(otherSelfId) && otherSelfId !== selfId);

let body = JSON.stringify({ authId: AUTH_ID });
r = await call(
  await fetch(`${USER_PROVIDER}/internal/profiles/resolve`, {
    method: 'POST',
    headers: hmacHeaders('ai-content-service', 'POST', '/internal/profiles/resolve', body),
    body,
  }),
);
check(
  'no profileId resolves to the account’s own self profile',
  r.body.data?.profileId === selfId,
  r.body,
);
check('reply carries no PII', r.body.data?.first_name === undefined, r.body.data);

body = JSON.stringify({ authId: AUTH_ID, profileId: otherSelfId });
r = await call(
  await fetch(`${USER_PROVIDER}/internal/profiles/resolve`, {
    method: 'POST',
    headers: hmacHeaders('ai-content-service', 'POST', '/internal/profiles/resolve', body),
    body,
  }),
);
check('another account’s profile answers 404, never 403', r.status === 404, r);

r = await call(
  await fetch(`${USER_PROVIDER}/internal/profiles/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authId: AUTH_ID }),
  }),
);
check('unsigned call refused', r.status === 401, r);

// ── 2. Dependent profile ─────────────────────────────────────────────────────

console.log('\n2. Create a dependent profile to scope intake against');

r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      relation: 'father',
      firstName: `Dad-${RUN}`,
      goal: 'Reverse prediabetes',
    }),
  }),
);
check('201 Created', r.status === 201, r);
const dadId: string = r.body.data?.id;

r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'mother', firstName: `Mum-${RUN}` }),
  }),
);
const mumId: string = r.body.data?.id;
check('two dependents created', Boolean(dadId && mumId));

// ── 3. POST /intake (W7-3) ───────────────────────────────────────────────────

console.log('\n3. POST /intake — scoped to the active profile');

const dadIntake = {
  symptoms: ['fatigue in the afternoon', 'joint stiffness on waking'],
  goals: ['reverse prediabetes'],
  conditions: ['prediabetes'],
  medications: ['metformin 500mg'],
  pillarPriorities: ['nutrition', 'sleep'],
  notes: `run-${RUN}`,
};

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
    body: JSON.stringify(dadIntake),
  }),
);
check('201 Created', r.status === 201, r);
check(
  'stored against the father profile, not the account owner',
  r.body.data?.profile_id === dadId,
  r.body.data,
);
check('first submission is version 1', r.body.data?.version === 1, r.body.data);
check(
  'submitter auth id is not returned',
  r.body.data?.submitted_by_auth_id === undefined,
  r.body.data,
);

let dbRows = await ai`
  SELECT profile_id, version, symptoms, submitted_by_auth_id
  FROM intake_submissions WHERE profile_id = ${dadId}::uuid ORDER BY version
`;
check('database has exactly one row for the father', dbRows.length === 1, dbRows);
check('database row names the father profile', dbRows[0]?.profile_id === dadId, dbRows[0]);
check(
  'database row records who submitted it',
  dbRows[0]?.submitted_by_auth_id === AUTH_ID,
  dbRows[0],
);

console.log('\n4. POST /intake again — versioned, never overwritten');

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
    body: JSON.stringify({ ...dadIntake, symptoms: [...dadIntake.symptoms, 'poor sleep'] }),
  }),
);
check('201 Created', r.status === 201, r);
check('second submission is version 2', r.body.data?.version === 2, r.body.data);

dbRows = await ai`
  SELECT version, symptoms FROM intake_submissions
  WHERE profile_id = ${dadId}::uuid ORDER BY version
`;
check('both versions survive', dbRows.length === 2, dbRows);
check(
  'version 1 still holds its original answers',
  Array.isArray(dbRows[0]?.symptoms) && (dbRows[0].symptoms as string[]).length === 2,
  dbRows[0],
);

// ── 5. Profile isolation ─────────────────────────────────────────────────────

console.log('\n5. One profile’s intake is invisible to another');

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': mumId },
    body: JSON.stringify({
      symptoms: ['headaches'],
      goals: [],
      conditions: [],
      medications: [],
      pillarPriorities: [],
    }),
  }),
);
check('mother’s intake stored', r.status === 201 && r.body.data?.profile_id === mumId, r.body.data);

r = await call(await fetch(`${BASE}/intake/${mumId}`, { headers: authHeaders }));
check(
  'mother’s intake reads back her answers',
  r.body.data?.symptoms?.[0] === 'headaches',
  r.body.data,
);
check('and only hers', r.body.data?.symptoms?.length === 1, r.body.data);

r = await call(await fetch(`${BASE}/intake/${dadId}`, { headers: authHeaders }));
check('father’s latest is version 2', r.body.data?.version === 2, r.body.data);

r = await call(await fetch(`${BASE}/intake/${dadId}?version=1`, { headers: authHeaders }));
check('an earlier version is still readable', r.body.data?.version === 1, r.body.data);

r = await call(await fetch(`${BASE}/intake/${dadId}/history`, { headers: authHeaders }));
check(
  'history lists both versions newest first',
  r.body.data?.[0]?.version === 2 && r.body.data?.length === 2,
  r.body.data,
);

// ── 6. Cross-account isolation ───────────────────────────────────────────────

console.log('\n6. Another account cannot reach this family’s intake');

r = await call(await fetch(`${BASE}/intake/${dadId}`, { headers: otherAccountHeaders }));
check('404, never 403 — a 403 would confirm the profile exists', r.status === 404, r);

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: { ...otherAccountHeaders, 'X-Active-Profile-Id': dadId },
    body: JSON.stringify({
      symptoms: ['injected'],
      goals: [],
      conditions: [],
      medications: [],
      pillarPriorities: [],
    }),
  }),
);
check('writing to another account’s profile answers 404', r.status === 404, r);

dbRows = await ai`
  SELECT version FROM intake_submissions WHERE profile_id = ${dadId}::uuid
`;
check('and wrote nothing — still two versions', dbRows.length === 2, dbRows);

// ── 7. The three negative cases every profile-scoped route carries ───────────

console.log('\n7. Auth, permission and validation');

r = await call(await fetch(`${BASE}/intake/${dadId}`));
check('no token → 401', r.status === 401, r);

r = await call(await fetch(`${BASE}/intake/${dadId}`, { headers: noPermissionHeaders }));
check('missing intake:read → 403', r.status === 403, r);

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ symptoms: 'not-an-array' }),
  }),
);
check('malformed body → 400', r.status === 400, r);
check(
  'and names the failing field',
  r.body.error?.details?.fields?.[0]?.field === 'symptoms',
  r.body.error,
);
check(
  'without echoing the submitted value',
  !JSON.stringify(r.body).includes('not-an-array'),
  r.body,
);

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      symptoms: [],
      goals: [],
      conditions: [],
      medications: [],
      pillarPriorities: ['telepathy'],
    }),
  }),
);
check('a pillar outside the taxonomy → 400', r.status === 400, r);

r = await call(
  await fetch(`${BASE}/intake`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': crypto.randomUUID() },
    body: JSON.stringify({
      symptoms: [],
      goals: [],
      conditions: [],
      medications: [],
      pillarPriorities: [],
    }),
  }),
);
check('an invented active profile → 404', r.status === 404, r);

// ── 8. Onboarding session ownership (W7-4, finding F1) ───────────────────────

console.log('\n8. An onboarding session is not readable by its id alone');

// The conversation itself lives in the Python agent, which is not part of this
// suite. The ownership record is this service's, and it is what decides the
// answer — so the check runs without the agent by claiming a session directly.
const sessionId = `sess-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
await ai`
  INSERT INTO onboarding_sessions (session_id, auth_id, profile_id)
  VALUES (${sessionId}, ${AUTH_ID}::uuid, ${dadId}::uuid)
`;

r = await call(await fetch(`${BASE}/ai/sessions/${sessionId}`, { headers: otherAccountHeaders }));
check('another account reading the session → 404', r.status === 404, r);

r = await call(await fetch(`${BASE}/ai/sessions/${crypto.randomUUID()}`, { headers: authHeaders }));
check('an unknown session id → 404, the same answer', r.status === 404, r);

r = await call(await fetch(`${BASE}/ai/sessions/history`, { headers: authHeaders }));
check('history lists the account’s own sessions', r.status === 200, r);
check(
  'and each one carries the profile it is about',
  (r.body.data ?? []).some((s: any) => s.session_id === sessionId && s.profile_id === dadId),
  r.body.data,
);

r = await call(await fetch(`${BASE}/ai/sessions/history`, { headers: otherAccountHeaders }));
check(
  'the other account’s history does not contain it',
  !(r.body.data ?? []).some((s: any) => s.session_id === sessionId),
  r.body.data,
);

// ── 9. PHI audit trail ───────────────────────────────────────────────────────

console.log('\n9. Every intake access — including the refused ones — is recorded');

const auditRows = await ai`
  SELECT action, profile_id, status_code, success, actor_id
  FROM phi_access_log
  WHERE profile_id = ${dadId}::uuid
  ORDER BY occurred_at
`;
check('the father’s accesses are logged', auditRows.length > 0, auditRows.length);
check(
  'denials are logged too — the rows an access review looks for',
  auditRows.some((row: any) => row.success === false),
  auditRows.filter((row: any) => !row.success).length,
);
check(
  'the denied read is attributed to the account that attempted it',
  auditRows.some((row: any) => row.success === false && row.actor_id === OTHER_AUTH_ID),
  auditRows.filter((row: any) => !row.success),
);

const appendOnly = await ai`
  SELECT id FROM phi_access_log WHERE profile_id = ${dadId}::uuid LIMIT 1
`;
let rejected = false;
try {
  await ai`DELETE FROM phi_access_log WHERE id = ${appendOnly[0].id}::uuid`;
} catch {
  rejected = true;
}
check('the audit log refuses deletion at the database level', rejected);

// ── Teardown ─────────────────────────────────────────────────────────────────

for (const id of [dadId, mumId]) {
  if (id)
    await fetch(`${USER_PROVIDER}/profiles/${id}`, { method: 'DELETE', headers: authHeaders });
}
await core.end();
await ai.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
