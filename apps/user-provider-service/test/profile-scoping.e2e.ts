/**
 * End-to-end tests for multi-profile data isolation on the /progress surface.
 *
 * The contract under test (docs/09-auth-permissions-and-profile-context.md §3):
 * health data belongs to a PROFILE, not to the account. One account owns many
 * profiles; `X-Active-Profile-Id` names which one a request acts as; omitting it
 * acts as the account owner's `self` profile; a profile the account does not own
 * answers 404, never 403.
 *
 * Real service, real PostgreSQL, real Redis — no mocks. Requires:
 *   1. Postgres + Redis up, `longeny_core` schema pushed (bunx drizzle-kit push)
 *   2. The test account seeded (see docs/08-profiles-rro-api-testing.md §3)
 *   3. user-provider-service running on :3002
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/test/profile-scoping.e2e.ts
 *
 * Re-runnable: every run creates its own father/mother profiles and asserts on
 * those specific row ids, so it never depends on a clean database.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3002';
const AUTH_ID = process.env.TEST_AUTH_ID ?? '22222222-2222-2222-2222-222222222222';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'vishal.test@longeny.com';

/**
 * A second account, distinct from the ids profiles-rro.e2e.ts uses (2222…/3333…)
 * so the two suites can run back to back without touching each other's rows.
 */
const OTHER_AUTH_ID =
  process.env.TEST_SCOPING_OTHER_AUTH_ID ?? '44444444-4444-4444-4444-444444444444';
const OTHER_EMAIL = 'scoping-other@longeny.com';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: TEST_EMAIL,
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

const ownerToken = mintToken();
const otherToken = mintToken({ sub: OTHER_AUTH_ID, email: OTHER_EMAIL });

/** Account-owner headers, optionally acting as one of the account's profiles. */
function as(token: string, profileId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (profileId) headers['X-Active-Profile-Id'] = profileId;
  return headers;
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
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/** Anything the API returns in a list — only the id matters to these checks. */
type Row = { id?: string; is_self?: boolean };

/** True when a response payload contains a row with this id. */
function hasId(rows: unknown, id: string) {
  return Array.isArray(rows) && (rows as Row[]).some((row) => row?.id === id);
}

/** The ids of a list response, or [] when the call did not return a list. */
function idsOf(rows: unknown): string[] {
  return Array.isArray(rows) ? (rows as Row[]).map((row) => row.id as string) : [];
}

// ── Preflight ────────────────────────────────────────────────────────────────

try {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (err) {
  console.error(`Service not reachable at ${BASE} — start it first.\n  ${err}`);
  process.exit(1);
}

// ── Fixture: a real second account ───────────────────────────────────────────
// Without a users row, the foreign token 404s because the *account* is missing,
// which would pass the cross-account checks below for the wrong reason. Inserting
// the row makes those checks exercise the ownership guard itself.

const sql = postgres(process.env.CORE_DATABASE_URL as string);
await sql`
  INSERT INTO users (auth_id, email, first_name, last_name)
  VALUES (${OTHER_AUTH_ID}::uuid, ${OTHER_EMAIL}, 'Scoping', 'Outsider')
  ON CONFLICT (auth_id) DO NOTHING
`;
await sql.end();

// ── 1. Two dependent profiles under one account ──────────────────────────────

console.log('\n1. One account, two dependent profiles');
let r = await call(await fetch(`${BASE}/profiles`, { headers: as(ownerToken) }));
check('GET /profiles 200', r.status === 200, r);
const selfId = (r.body.data as Row[] | undefined)?.find((p) => p.is_self)?.id;
check('account has a self profile', Boolean(selfId), r.body.data);

r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: as(ownerToken),
    body: JSON.stringify({ relation: 'father', firstName: 'Ramesh', lastName: 'Scoping' }),
  }),
);
check('father profile created', r.status === 201 && r.body.data?.relation === 'father', r);
const fatherId = r.body.data?.id;

r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: as(ownerToken),
    body: JSON.stringify({ relation: 'mother', firstName: 'Sunita', lastName: 'Scoping' }),
  }),
);
check('mother profile created', r.status === 201 && r.body.data?.relation === 'mother', r);
const motherId = r.body.data?.id;

check(
  'father and mother are distinct profiles',
  Boolean(fatherId && motherId && fatherId !== motherId),
  {
    fatherId,
    motherId,
  },
);
check('neither dependent is the self profile', fatherId !== selfId && motherId !== selfId, {
  selfId,
  fatherId,
  motherId,
});

if (!fatherId || !motherId || !selfId) {
  console.error('\nCannot continue: profile fixtures were not created.');
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
  process.exit(1);
}

// ── 2. Write health data while acting as the father ──────────────────────────

console.log('\n2. Write progress data acting as the father profile');
const asFather = as(ownerToken, fatherId);

// Baseline: what the self profile owns *before* the father writes anything.
// /progress/entries upserts on (subject, metric, date). If that upsert is keyed
// on the account rather than the profile, the father's write silently takes over
// the self profile's row of the same metric — which a "father's row is absent"
// check alone would not catch, because the row would have changed hands.
r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(ownerToken) }));
const selfEntryIdsBefore = idsOf(r.body.data);

r = await call(
  await fetch(`${BASE}/progress/entries`, {
    method: 'POST',
    headers: asFather,
    body: JSON.stringify({
      metricType: 'weight',
      value: 82.5,
      unit: 'kg',
      notes: "father's weight",
    }),
  }),
);
check('POST /progress/entries 201', r.status === 201, r);
const fatherEntryId = r.body.data?.id;
check('entry id returned', Boolean(fatherEntryId), r.body.data);

r = await call(
  await fetch(`${BASE}/progress/habits`, {
    method: 'POST',
    headers: asFather,
    body: JSON.stringify({ name: 'Morning walk (father)', frequency: 'DAILY', targetCount: 1 }),
  }),
);
check('POST /progress/habits 201', r.status === 201, r);
const fatherHabitId = r.body.data?.id;
check('habit id returned', Boolean(fatherHabitId), r.body.data);

r = await call(
  await fetch(`${BASE}/progress/goals`, {
    method: 'POST',
    headers: asFather,
    body: JSON.stringify({
      title: 'Reverse type-2 diabetes (father)',
      startDate: new Date().toISOString().split('T')[0],
      targetValue: 75,
      unit: 'kg',
    }),
  }),
);
check('POST /progress/goals 201', r.status === 201, r);
const fatherGoalId = r.body.data?.id;
check('goal id returned', Boolean(fatherGoalId), r.body.data);

console.log('\n3. The father profile reads back its own rows');
r = await call(await fetch(`${BASE}/progress/entries`, { headers: asFather }));
check('father sees his entry', r.status === 200 && hasId(r.body.data, fatherEntryId), r.body);

r = await call(await fetch(`${BASE}/progress/habits`, { headers: asFather }));
check('father sees his habit', r.status === 200 && hasId(r.body.data, fatherHabitId), r.body);

r = await call(await fetch(`${BASE}/progress/goals`, { headers: asFather }));
check('father sees his goal', r.status === 200 && hasId(r.body.data, fatherGoalId), r.body);

// ── 4. Sibling profile under the SAME account sees none of it ────────────────

console.log('\n4. The mother profile — same account — sees none of the father’s rows');
const asMother = as(ownerToken, motherId);

r = await call(await fetch(`${BASE}/progress/entries`, { headers: asMother }));
check('entries: 200', r.status === 200, r.status);
check("entries: father's entry absent", !hasId(r.body.data, fatherEntryId), r.body.data);

r = await call(await fetch(`${BASE}/progress/habits`, { headers: asMother }));
check('habits: 200', r.status === 200, r.status);
check("habits: father's habit absent", !hasId(r.body.data, fatherHabitId), r.body.data);

r = await call(await fetch(`${BASE}/progress/goals`, { headers: asMother }));
check('goals: 200', r.status === 200, r.status);
check("goals: father's goal absent", !hasId(r.body.data, fatherGoalId), r.body.data);

// ── 5. No header at all = the account owner's self profile ───────────────────

console.log('\n5. No X-Active-Profile-Id — acts as self, and self is not the father');
const asSelf = as(ownerToken);

r = await call(await fetch(`${BASE}/progress/entries`, { headers: asSelf }));
check('entries: 200 (header is optional)', r.status === 200, r.status);
check("entries: father's entry absent", !hasId(r.body.data, fatherEntryId), r.body.data);

r = await call(await fetch(`${BASE}/progress/habits`, { headers: asSelf }));
check('habits: 200', r.status === 200, r.status);
check("habits: father's habit absent", !hasId(r.body.data, fatherHabitId), r.body.data);

r = await call(await fetch(`${BASE}/progress/goals`, { headers: asSelf }));
check('goals: 200', r.status === 200, r.status);
check("goals: father's goal absent", !hasId(r.body.data, fatherGoalId), r.body.data);

r = await call(await fetch(`${BASE}/progress/entries?limit=100`, { headers: asSelf }));
const selfEntryIdsAfter = idsOf(r.body.data);
const stolen = selfEntryIdsBefore.filter((id) => !selfEntryIdsAfter.includes(id));
check("the father's write did not take over any of self's rows", stolen.length === 0, stolen);

// Explicitly naming the self profile must behave identically to omitting it.
r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(ownerToken, selfId) }));
check(
  'explicit self id behaves the same as no header',
  r.status === 200 && !hasId(r.body.data, fatherEntryId),
  r.body,
);

// ── 6. Dashboard reflects only the acting profile ────────────────────────────

console.log('\n6. GET /progress/dashboard is scoped to the acting profile');
r = await call(await fetch(`${BASE}/progress/dashboard`, { headers: asFather }));
check('father dashboard 200', r.status === 200, r.status);
check(
  "father dashboard shows the father's entry",
  hasId(r.body.data?.recentEntries, fatherEntryId),
  r.body.data?.recentEntries,
);
check(
  "father dashboard shows the father's habit",
  hasId(r.body.data?.activeHabits, fatherHabitId),
  r.body.data?.activeHabits,
);

r = await call(await fetch(`${BASE}/progress/dashboard`, { headers: asMother }));
check('mother dashboard 200', r.status === 200, r.status);
check(
  "mother dashboard hides the father's entry",
  !hasId(r.body.data?.recentEntries, fatherEntryId),
  r.body.data?.recentEntries,
);
check(
  "mother dashboard hides the father's habit",
  !hasId(r.body.data?.activeHabits, fatherHabitId),
  r.body.data?.activeHabits,
);

r = await call(await fetch(`${BASE}/progress/dashboard`, { headers: asSelf }));
check('self dashboard 200', r.status === 200, r.status);
check(
  "self dashboard hides the father's entry",
  !hasId(r.body.data?.recentEntries, fatherEntryId),
  r.body.data?.recentEntries,
);
check(
  "self dashboard hides the father's habit",
  !hasId(r.body.data?.activeHabits, fatherHabitId),
  r.body.data?.activeHabits,
);

// ── 7. A different account sees nothing, and cannot confirm existence ────────

console.log('\n7. A second account (different JWT sub) is isolated');
r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(otherToken) }));
check('other account: entries 200 for its own self profile', r.status === 200, r);
check("other account: father's entry absent", !hasId(r.body.data, fatherEntryId), r.body.data);

r = await call(await fetch(`${BASE}/progress/habits`, { headers: as(otherToken) }));
check("other account: father's habit absent", !hasId(r.body.data, fatherHabitId), r.body.data);

r = await call(await fetch(`${BASE}/progress/goals`, { headers: as(otherToken) }));
check("other account: father's goal absent", !hasId(r.body.data, fatherGoalId), r.body.data);

r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(otherToken, fatherId) }));
check("other account naming the father's profile id → 404, never 403", r.status === 404, {
  status: r.status,
  body: r.body,
});

r = await call(await fetch(`${BASE}/progress/dashboard`, { headers: as(otherToken, fatherId) }));
check('…same on the dashboard route → 404', r.status === 404, r.status);

r = await call(
  await fetch(`${BASE}/progress/entries`, {
    method: 'POST',
    headers: as(otherToken, fatherId),
    body: JSON.stringify({ metricType: 'weight', value: 1, unit: 'kg' }),
  }),
);
check('…and cannot write into it → 404', r.status === 404, { status: r.status, body: r.body });

// ── 8. Bad profile ids are 404, never 500 ────────────────────────────────────

console.log('\n8. Malformed / unknown X-Active-Profile-Id');
r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(ownerToken, 'not-a-uuid') }));
check('malformed id → 404, not 500', r.status === 404, { status: r.status, body: r.body });

const ghostId = crypto.randomUUID();
r = await call(await fetch(`${BASE}/progress/entries`, { headers: as(ownerToken, ghostId) }));
check('non-existent id → 404', r.status === 404, { status: r.status, body: r.body });

r = await call(await fetch(`${BASE}/progress/dashboard`, { headers: as(ownerToken, '') }));
check('empty header falls back to self → 200', r.status === 200, r.status);

// ── 9. Cross-profile delete must not delete ──────────────────────────────────

console.log('\n9. Deleting the father’s entry while acting as the mother');
r = await call(
  await fetch(`${BASE}/progress/entries/${fatherEntryId}`, {
    method: 'DELETE',
    headers: asMother,
  }),
);
check('mother cannot delete it (not 200)', r.status !== 200, { status: r.status, body: r.body });

r = await call(await fetch(`${BASE}/progress/entries`, { headers: asFather }));
check(
  'entry still readable by the father afterwards',
  r.status === 200 && hasId(r.body.data, fatherEntryId),
  r.body,
);

r = await call(
  await fetch(`${BASE}/progress/entries/${fatherEntryId}`, {
    method: 'DELETE',
    headers: as(otherToken),
  }),
);
check('other account cannot delete it either (not 200)', r.status !== 200, {
  status: r.status,
  body: r.body,
});

r = await call(await fetch(`${BASE}/progress/entries`, { headers: asFather }));
check(
  'entry survives the cross-account delete too',
  r.status === 200 && hasId(r.body.data, fatherEntryId),
  r.body,
);

// The owner acting as the right profile may of course delete it.
r = await call(
  await fetch(`${BASE}/progress/entries/${fatherEntryId}`, {
    method: 'DELETE',
    headers: asFather,
  }),
);
check('the father profile itself can delete it → 200', r.status === 200, {
  status: r.status,
  body: r.body,
});

r = await call(await fetch(`${BASE}/progress/entries`, { headers: asFather }));
check('entry gone after the in-profile delete', !hasId(r.body.data, fatherEntryId), r.body.data);

// ── Cleanup: deactivate the profiles this run created ────────────────────────

await fetch(`${BASE}/profiles/${fatherId}`, { method: 'DELETE', headers: as(ownerToken) });
await fetch(`${BASE}/profiles/${motherId}`, { method: 'DELETE', headers: as(ownerToken) });

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
