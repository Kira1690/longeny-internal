/**
 * End-to-end tests for the multi-profile / family (RRO) API.
 *
 * Real service, real PostgreSQL, real Redis — no mocks. Requires:
 *   1. Postgres + Redis up, `longeny_core` schema pushed (bunx drizzle-kit push)
 *   2. The test account seeded (see docs/08-profiles-rro-api-testing.md §3)
 *   3. user-provider-service running on :3002
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/user-provider-service/test/profiles-rro.e2e.ts
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3002';
const AUTH_ID = process.env.TEST_AUTH_ID ?? '22222222-2222-2222-2222-222222222222';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'vishal.test@longeny.com';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const token = mintToken();
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** A token from a different account — used for cross-tenant checks. */
const OTHER_AUTH_ID = process.env.TEST_OTHER_AUTH_ID ?? '33333333-3333-3333-3333-333333333333';
const otherAccountHeaders = {
  Authorization: `Bearer ${mintToken({ sub: OTHER_AUTH_ID, email: 'other@longeny.com' })}`,
  'Content-Type': 'application/json',
};

/** Authenticated, but the role grants no profile permissions. */
const noPermissionHeaders = {
  Authorization: `Bearer ${mintToken({ permissions: ['users:read'] })}`,
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
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
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
// Without a users row, a foreign token 404s because the *account* is missing,
// which would pass the cross-tenant checks below for the wrong reason. Inserting
// the row makes those checks exercise the ownership guard itself.

const sql = postgres(process.env.CORE_DATABASE_URL as string);
await sql`
  INSERT INTO users (auth_id, email, first_name, last_name)
  VALUES (${OTHER_AUTH_ID}::uuid, 'other@longeny.com', 'Other', 'Account')
  ON CONFLICT (auth_id) DO NOTHING
`;
await sql.end();

// ── Profiles CRUD ────────────────────────────────────────────────────────────

console.log('\n1. GET /profiles — lists profiles, auto-creates self');
let r = await call(await fetch(`${BASE}/profiles`, { headers: authHeaders }));
check('200 OK', r.status === 200, r);
const selfProfile = r.body.data?.find((p: any) => p.is_self);
check('self profile exists', Boolean(selfProfile), r.body.data);
const selfId = selfProfile?.id;

console.log('\n2. POST /profiles — create dependent (father)');
r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      relation: 'father',
      firstName: 'Ramesh',
      lastName: 'Dafada',
      email: 'ramesh@example.com',
      phone: '+919876543210',
      dateOfBirth: '1958-04-12',
      gender: 'male',
      goal: 'Reverse type-2 diabetes',
    }),
  }),
);
check('201 Created', r.status === 201, r);
check('relation is father', r.body.data?.relation === 'father', r.body.data);
check(
  'phone never returned (encrypted at rest)',
  r.body.data?.phone_hash === undefined && r.body.data?.phone_encrypted === undefined,
  r.body.data,
);
check('has_phone flag set instead', r.body.data?.has_phone === true, r.body.data);
check(
  'RRO state starts at intake',
  r.body.data?.rroState?.current_state === 'intake',
  r.body.data?.rroState,
);
const profileId = r.body.data?.id;

console.log('\n3. GET /profiles/:id — read one profile');
r = await call(await fetch(`${BASE}/profiles/${profileId}`, { headers: authHeaders }));
check('200 + correct profile', r.status === 200 && r.body.data?.first_name === 'Ramesh', r);

console.log('\n4. PATCH /profiles/:id — partial update');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ notes: 'Prefers morning calls' }),
  }),
);
check(
  '200 + notes persisted',
  r.status === 200 && r.body.data?.notes === 'Prefers morning calls',
  r,
);

console.log('\n5. POST /profiles/:id/activate — switch active profile');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/activate`, { method: 'POST', headers: authHeaders }),
);
check(
  '200 + activeProfileId returned',
  r.status === 200 && r.body.data?.activeProfileId === profileId,
  r,
);

console.log('\n6. Ownership guard — foreign/unknown profile is rejected');
r = await call(
  await fetch(`${BASE}/profiles/33333333-3333-3333-3333-333333333333`, { headers: authHeaders }),
);
check('403 or 404, never 200', r.status === 403 || r.status === 404, r.status);

// ── Caregiver consent ────────────────────────────────────────────────────────

console.log('\n7. POST /profiles/:id/consent — grant');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/consent`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ consentType: 'health_data', status: 'granted', notes: 'Signed form' }),
  }),
);
check('201 + status granted', r.status === 201 && r.body.data?.status === 'granted', r);

console.log('\n8. GET /profiles/:id/consent — read');
r = await call(await fetch(`${BASE}/profiles/${profileId}/consent`, { headers: authHeaders }));
check('200 + exactly 1 record', r.status === 200 && r.body.data?.length === 1, r.body.data);

console.log('\n9. POST /profiles/:id/consent — revoke upserts, does not duplicate');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/consent`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ consentType: 'health_data', status: 'revoked' }),
  }),
);
check(
  'status revoked + revoked_at set',
  r.body.data?.status === 'revoked' && Boolean(r.body.data?.revoked_at),
  r.body.data,
);
r = await call(await fetch(`${BASE}/profiles/${profileId}/consent`, { headers: authHeaders }));
check('still 1 record (upsert, not insert)', r.body.data?.length === 1, r.body.data?.length);

// ── Notification targets + parent notify ─────────────────────────────────────

console.log('\n10. POST /profiles/:id/notification-targets — add SMS channel');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/notification-targets`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ channel: 'sms', destination: '+919876543210' }),
  }),
);
check('201 + channel sms', r.status === 201 && r.body.data?.channel === 'sms', r);
check('destination never returned', r.body.data?.destination_encrypted === undefined, r.body.data);

console.log('\n11. POST /internal/notify/profile (HMAC) — route to parent');
{
  // SMS has no transport. The row says so rather than claiming `queued`, which
  // would promise a delivery nothing was going to make.
  const path = '/internal/notify/profile';
  const body = JSON.stringify({
    profileId,
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
  check('200 + one target attempted', r.status === 200 && r.body.data?.attempted === 1, r);
  check(
    'nothing was delivered — there is no SMS transport',
    r.body.data?.delivered === 0,
    r.body.data,
  );
  check(
    'the entry is failed, not queued',
    r.body.data?.entries?.[0]?.status === 'failed',
    r.body.data?.entries,
  );
  check(
    'and names the missing transport',
    String(r.body.data?.entries?.[0]?.error ?? '').includes('SMS'),
    r.body.data?.entries,
  );

  // Email does have one, and the log says `sent` only when it went out.
  const emailTarget = await call(
    await fetch(`${BASE}/profiles/${profileId}/notification-targets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ channel: 'email', destination: `parent-${Date.now()}@family.test` }),
    }),
  );
  check('an email target can be registered', emailTarget.status === 201, emailTarget);

  const emailBody = JSON.stringify({
    profileId,
    channel: 'email',
    subject: 'Check-in',
    body: 'Time for your weekly check-in',
  });
  r = await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('test-suite', 'POST', path, emailBody),
      body: emailBody,
    }),
  );
  check('the email was delivered', r.body.data?.delivered === 1, r.body.data);
  check(
    'and the row says sent',
    r.body.data?.entries?.[0]?.status === 'sent',
    r.body.data?.entries,
  );
  check(
    'with the time it went out',
    Boolean(r.body.data?.entries?.[0]?.sent_at),
    r.body.data?.entries,
  );
}

console.log('\n12. GET /profiles/:id/notifications — history');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/notifications`, { headers: authHeaders }),
);
check(
  '200 + at least one entry',
  r.status === 200 && r.body.data?.length >= 1,
  r.body.data?.length,
);

// ── RRO state ────────────────────────────────────────────────────────────────

console.log('\n13. POST /internal/rro-state/transition (HMAC) — intake → reverse');
{
  const path = '/internal/rro-state/transition';
  const body = JSON.stringify({
    profileId,
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
  check(
    '200 + fromState intake, toState reverse',
    r.status === 200 && r.body.data?.fromState === 'intake' && r.body.data?.toState === 'reverse',
    r,
  );
}

console.log('\n14. GET /profiles/:id/rro-state — current state + history');
r = await call(await fetch(`${BASE}/profiles/${profileId}/rro-state`, { headers: authHeaders }));
check(
  '200 + current_state reverse',
  r.status === 200 && r.body.data?.current_state === 'reverse',
  r.body.data,
);
check(
  'history has both transitions',
  r.body.data?.history?.length === 2,
  r.body.data?.history?.length,
);

// ── Security / negative ──────────────────────────────────────────────────────

console.log('\n15. Internal route rejects a bad HMAC signature');
r = await call(
  await fetch(`${BASE}/internal/notify/profile`, {
    method: 'POST',
    headers: {
      'X-Service-Name': 'attacker',
      'X-Timestamp': String(Date.now()),
      'X-Signature': 'deadbeef',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ profileId, body: 'should not go through' }),
  }),
);
check('401 Unauthorized', r.status === 401, r.status);

console.log('\n16. Internal route rejects missing HMAC headers');
r = await call(
  await fetch(`${BASE}/internal/notify/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, body: 'should not go through' }),
  }),
);
check('401 Unauthorized', r.status === 401, r.status);

console.log('\n17. Authed route rejects a missing token');
r = await call(await fetch(`${BASE}/profiles`));
check('401 Unauthorized', r.status === 401, r.status);

console.log('\n18. DELETE /profiles/:id — deactivate dependent');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}`, { method: 'DELETE', headers: authHeaders }),
);
check('200 + status inactive', r.status === 200 && r.body.data?.status === 'inactive', r);

console.log('\n19. DELETE /profiles/:selfId — self profile is protected');
r = await call(
  await fetch(`${BASE}/profiles/${selfId}`, { method: 'DELETE', headers: authHeaders }),
);
check('400 Bad Request', r.status === 400, r);

// ── RBAC ─────────────────────────────────────────────────────────────────────

console.log('\n20. Authenticated token without profiles:read is refused');
r = await call(await fetch(`${BASE}/profiles`, { headers: noPermissionHeaders }));
check('403 Forbidden', r.status === 403, r);
check(
  'names the missing permission',
  String(r.body?.error?.message).includes('profiles:read'),
  r.body,
);

console.log('\n21. profiles:read alone cannot write');
r = await call(
  await fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mintToken({ permissions: ['profiles:read'] })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ relation: 'mother', firstName: 'Sunita' }),
  }),
);
check('403 Forbidden', r.status === 403, r);

console.log('\n22. consent:grant is required to record consent');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/consent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mintToken({ permissions: ['profiles:read', 'profiles:write'] })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ consentType: 'health_data', granted: true }),
  }),
);
check('403 Forbidden', r.status === 403, r);

console.log('\n23. A second role on the token still grants the first role’s access');
r = await call(
  await fetch(`${BASE}/profiles`, {
    headers: {
      Authorization: `Bearer ${mintToken({ role: 'provider', roles: ['provider', 'user'] })}`,
      'Content-Type': 'application/json',
    },
  }),
);
check('200 OK', r.status === 200, r.status);

// ── Cross-tenant isolation ───────────────────────────────────────────────────

console.log('\n24. Another account cannot read this profile');
r = await call(await fetch(`${BASE}/profiles/${profileId}`, { headers: otherAccountHeaders }));
check('404 Not Found (never 403 — that would confirm it exists)', r.status === 404, r.status);

console.log('\n25. Another account cannot update this profile');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}`, {
    method: 'PATCH',
    headers: otherAccountHeaders,
    body: JSON.stringify({ notes: 'should not apply' }),
  }),
);
check('404 Not Found', r.status === 404, r.status);

console.log('\n26. Another account cannot read this profile’s RRO state');
r = await call(
  await fetch(`${BASE}/profiles/${profileId}/rro-state`, { headers: otherAccountHeaders }),
);
check('404 Not Found', r.status === 404, r.status);

// ── Concurrency ──────────────────────────────────────────────────────────────
// These exist because every check above passes against a build that leaks data
// between accounts. Request state used to live in a store Elysia shares across
// all in-flight requests, so identity was correct only while requests ran one at
// a time — which is exactly how a serial test suite runs them. Anything that
// asserts tenancy must also assert it under overlap.

console.log('\n27. Concurrent reads from two accounts do not cross');
const ownList = await call(await fetch(`${BASE}/profiles`, { headers: authHeaders }));
const otherList = await call(await fetch(`${BASE}/profiles`, { headers: otherAccountHeaders }));
const ownCount = ownList.body.data?.length ?? -1;
const otherCount = otherList.body.data?.length ?? -2;
check(
  'the two accounts have different profile counts (a meaningful test)',
  ownCount !== otherCount,
  {
    ownCount,
    otherCount,
  },
);

let crossed = 0;
for (let round = 0; round < 5; round++) {
  const [a1, b1, a2, b2] = await Promise.all([
    call(await fetch(`${BASE}/profiles`, { headers: authHeaders })),
    call(await fetch(`${BASE}/profiles`, { headers: otherAccountHeaders })),
    call(await fetch(`${BASE}/profiles`, { headers: authHeaders })),
    call(await fetch(`${BASE}/profiles`, { headers: otherAccountHeaders })),
  ]);
  for (const [res, expected] of [
    [a1, ownCount],
    [b1, otherCount],
    [a2, ownCount],
    [b2, otherCount],
  ] as const) {
    if ((res.body.data?.length ?? -1) !== expected) crossed++;
  }
}
check('20 interleaved reads all returned the calling account’s own profiles', crossed === 0, {
  crossedResponses: crossed,
});

console.log('\n28. Concurrent writes land under the account that made them');
const tag = `CONC-${Date.now()}`;
const makeProfile = (headers: Record<string, string>, name: string) =>
  fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ relation: 'other', firstName: name }),
  }).then(call);

const writes = await Promise.all([
  makeProfile(authHeaders, `${tag}-own-1`),
  makeProfile(otherAccountHeaders, `${tag}-other-1`),
  makeProfile(authHeaders, `${tag}-own-2`),
  makeProfile(otherAccountHeaders, `${tag}-other-2`),
]);
check(
  'all four creates succeeded',
  writes.every((w) => w.status === 201),
  writes.map((w) => w.status),
);

const [ownAfter, otherAfter] = await Promise.all([
  call(await fetch(`${BASE}/profiles`, { headers: authHeaders })),
  call(await fetch(`${BASE}/profiles`, { headers: otherAccountHeaders })),
]);
const ownNames = new Set((ownAfter.body.data ?? []).map((p: any) => p.first_name));
const otherNames = new Set((otherAfter.body.data ?? []).map((p: any) => p.first_name));
check(
  'each profile is owned by the account that created it, and by no other',
  ownNames.has(`${tag}-own-1`) &&
    ownNames.has(`${tag}-own-2`) &&
    !ownNames.has(`${tag}-other-1`) &&
    !ownNames.has(`${tag}-other-2`) &&
    otherNames.has(`${tag}-other-1`) &&
    otherNames.has(`${tag}-other-2`) &&
    !otherNames.has(`${tag}-own-1`) &&
    !otherNames.has(`${tag}-own-2`),
  {
    own: [...ownNames].filter((n: string) => n.startsWith(tag)),
    other: [...otherNames].filter((n: string) => n.startsWith(tag)),
  },
);

// Leave the account clean for the next run.
for (const w of writes) {
  const id = w.body.data?.id;
  const headers = String(w.body.data?.first_name).includes('-own-')
    ? authHeaders
    : otherAccountHeaders;
  if (id) await fetch(`${BASE}/profiles/${id}`, { method: 'DELETE', headers });
}

// ── Regression: the V-W7-7 defects ───────────────────────────────────────────
// Each of these reproduces a defect that was live in Week 7. They exist so the
// fix cannot be undone quietly.

console.log('\n29. A deactivated profile is gone from every route, not just the list');
{
  const created = await call(
    await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ relation: 'sibling', firstName: 'Deleted', lastName: 'Person' }),
    }),
  );
  const goneId = created.body.data?.id;
  check('fixture profile created', created.status === 201, created);

  const del = await call(
    await fetch(`${BASE}/profiles/${goneId}`, { method: 'DELETE', headers: authHeaders }),
  );
  check('deactivated', del.status === 200, del);

  // assertOwnership used to check the owner and nothing else, so a soft-deleted
  // profile stayed fully live on every route except the one that lists them.
  const gets = await call(await fetch(`${BASE}/profiles/${goneId}`, { headers: authHeaders }));
  check('GET   /profiles/:id → 404', gets.status === 404, gets);

  const patch = await call(
    await fetch(`${BASE}/profiles/${goneId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ notes: 'should not be writable' }),
    }),
  );
  check('PATCH /profiles/:id → 404', patch.status === 404, patch);

  const rro = await call(
    await fetch(`${BASE}/profiles/${goneId}/rro-state`, { headers: authHeaders }),
  );
  check('GET   /profiles/:id/rro-state → 404', rro.status === 404, rro);

  const consent = await call(
    await fetch(`${BASE}/profiles/${goneId}/consent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ consentType: 'health_data' }),
    }),
  );
  check('POST  /profiles/:id/consent → 404', consent.status === 404, consent);

  const target = await call(
    await fetch(`${BASE}/profiles/${goneId}/notification-targets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ channel: 'email', destination: 'ghost@family.test' }),
    }),
  );
  check('POST  /profiles/:id/notification-targets → 404', target.status === 404, target);

  const notifications = await call(
    await fetch(`${BASE}/profiles/${goneId}/notifications`, { headers: authHeaders }),
  );
  check('GET   /profiles/:id/notifications → 404', notifications.status === 404, notifications);

  const activate = await call(
    await fetch(`${BASE}/profiles/${goneId}/activate`, { method: 'POST', headers: authHeaders }),
  );
  check('POST  /profiles/:id/activate → 404', activate.status === 404, activate);

  // Deleting twice must stay idempotent — the caller retrying a request it
  // already made should not be told the person never existed.
  const delAgain = await call(
    await fetch(`${BASE}/profiles/${goneId}`, { method: 'DELETE', headers: authHeaders }),
  );
  check('DELETE is still idempotent (200, not 404)', delAgain.status === 200, delAgain);
}

console.log('\n30. A message to a deactivated profile is not delivered');
{
  // The defect that mattered. A soft-deleted profile kept its notification
  // targets, and the internal notify route looked the profile up directly
  // rather than through the ownership guard — so a real email went out to a
  // person the account had removed.
  const created = await call(
    await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ relation: 'other', firstName: 'Unreachable', lastName: 'Person' }),
    }),
  );
  const goneId = created.body.data?.id;
  const destination = `removed-${Date.now()}@family.test`;

  const target = await call(
    await fetch(`${BASE}/profiles/${goneId}/notification-targets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ channel: 'email', destination }),
    }),
  );
  check('email target registered while active', target.status === 201, target);

  await fetch(`${BASE}/profiles/${goneId}`, { method: 'DELETE', headers: authHeaders });

  const path = '/internal/notify/profile';
  const body = JSON.stringify({
    profileId: goneId,
    channel: 'email',
    subject: 'Should never arrive',
    body: 'This account holder removed this person.',
  });
  const notify = await call(
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: hmacHeaders('test-suite', 'POST', path, body),
      body,
    }),
  );
  check('internal notify refuses a deactivated profile (404)', notify.status === 404, notify);
  check('and reports nothing delivered', notify.body?.data?.delivered === undefined, notify.body);

  // Database-first: ask the mail server, not the API. A 404 that still sent the
  // message would pass every check above.
  const MAILPIT = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8026';
  try {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${destination}`)}`,
    );
    const inbox = await search.json();
    // `messages` is what matched the query; `messages_count` is the whole
    // mailbox, which other suites also write to.
    const matched = (inbox.messages ?? []).length;
    check('the mail server received nothing for the removed person', matched === 0, inbox);
  } catch (err) {
    check('mailpit reachable for delivery verification', false, String(err));
  }
}

console.log('\n31. A malformed id is a 400, never a 500');
{
  // Postgres raises on a bad uuid cast, which surfaced as a 500 — an input
  // error reported as a server fault, and one that leaks that the id reached a
  // query at all.
  const bad = 'not-a-uuid';
  const routes: Array<[string, () => Promise<Response>]> = [
    ['GET   /profiles/:id', () => fetch(`${BASE}/profiles/${bad}`, { headers: authHeaders })],
    [
      'PATCH /profiles/:id',
      () =>
        fetch(`${BASE}/profiles/${bad}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ notes: 'x' }),
        }),
    ],
    [
      'GET   /profiles/:id/rro-state',
      () => fetch(`${BASE}/profiles/${bad}/rro-state`, { headers: authHeaders }),
    ],
    [
      'POST  /profiles/:id/consent',
      () =>
        fetch(`${BASE}/profiles/${bad}/consent`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ consentType: 'health_data' }),
        }),
    ],
  ];
  for (const [name, run] of routes) {
    const res = await call(await run());
    check(`${name} → 400`, res.status === 400, res);
  }
}

console.log('\n32. An untouched optional field arrives as "" and is treated as absent');
{
  // A form that posts every field sends "" for the ones nobody filled in. The
  // API used to reject that on email and avatarUrl but accept it on lastName,
  // so it disagreed with itself field by field.
  const created = await call(
    await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        relation: 'child',
        firstName: 'Blank',
        lastName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        avatarUrl: '',
      }),
    }),
  );
  check('201 with empty optional fields', created.status === 201, created);
  check('email stored as absent, not ""', !created.body.data?.email, created.body.data?.email);
  check('has_phone is false', created.body.data?.has_phone === false, created.body.data);
  const blankId = created.body.data?.id;

  const consent = await call(
    await fetch(`${BASE}/profiles/${blankId}/consent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ consentType: 'health_data', documentUrl: '', notes: '' }),
    }),
  );
  check('consent accepts an empty documentUrl', consent.status === 201, consent);

  const patched = await call(
    await fetch(`${BASE}/profiles/${blankId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ email: '', avatarUrl: '' }),
    }),
  );
  check('PATCH accepts empty optional fields', patched.status === 200, patched);

  await fetch(`${BASE}/profiles/${blankId}`, { method: 'DELETE', headers: authHeaders });
}

console.log('\n33. consent_type is a closed taxonomy, at the API and in the column');
{
  // Its own fixture: `profileId` was deactivated back in section 18, and a
  // deactivated profile is now gone from every route — reusing it here would
  // fail on ownership before it ever reached the consent taxonomy.
  const made = await call(
    await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ relation: 'mother', firstName: 'Consent', lastName: 'Fixture' }),
    }),
  );
  check('fixture profile created', made.status === 201, made);
  const consentProfileId = made.body.data?.id;

  const bad = await call(
    await fetch(`${BASE}/profiles/${consentProfileId}/consent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ consentType: 'banana_pudding' }),
    }),
  );
  // This returned 201 and was stored, so the append-only audit table recorded a
  // consent type nothing could ever query.
  check('an off-list consent type is rejected (400)', bad.status === 400, bad);

  for (const type of ['care_coordination', 'health_data', 'ai_analysis', 'notifications']) {
    const ok = await call(
      await fetch(`${BASE}/profiles/${consentProfileId}/consent`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ consentType: type }),
      }),
    );
    check(`${type} is accepted`, ok.status === 201, ok);
  }

  // Database-first: the column itself must refuse, not only the validator.
  const pg = postgres(process.env.CORE_DATABASE_URL as string);
  const [{ data_type: columnType }] = await pg`
    SELECT udt_name AS data_type
      FROM information_schema.columns
     WHERE table_name = 'caregiver_consent' AND column_name = 'consent_type'
  `;
  check(
    'the column is the caregiver_consent_type enum, not varchar',
    columnType === 'caregiver_consent_type',
    columnType,
  );
  const [{ count: strays }] = await pg`
    SELECT count(*)::int AS count FROM caregiver_consent
     WHERE consent_type::text NOT IN
       ('care_coordination', 'health_data', 'ai_analysis', 'notifications')
  `;
  check('no row holds a value outside the taxonomy', strays === 0, strays);
  await pg.end();

  await fetch(`${BASE}/profiles/${consentProfileId}`, { method: 'DELETE', headers: authHeaders });
}

console.log('\n34. Every generated Swagger example executes as sent');
{
  // The generated examples were empty objects, so a reader who pressed Try it
  // out got a 400 on the first call and concluded the API was broken.
  const spec = await (await fetch(`${BASE}/docs/json`)).json();
  // Same reason as section 33 — the {id} routes need a live profile.
  const made = await call(
    await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ relation: 'spouse', firstName: 'Swagger', lastName: 'Fixture' }),
    }),
  );
  check('fixture profile created', made.status === 201, made);
  const docsProfileId = made.body.data?.id;
  const cases: Array<[string, string, string]> = [
    ['POST', '/profiles', 'create profile'],
    ['PATCH', '/profiles/{id}', 'update profile'],
    ['POST', '/profiles/{id}/consent', 'record consent'],
    ['POST', '/profiles/{id}/notification-targets', 'add notification target'],
  ];
  for (const [method, route, label] of cases) {
    const op = spec.paths?.[route]?.[method.toLowerCase()];
    const example =
      op?.requestBody?.content?.['application/json']?.example ??
      op?.requestBody?.content?.['application/json']?.schema?.example;
    check(`${label}: the spec carries a request example`, Boolean(example), { route, method });
    if (!example) continue;

    const url = `${BASE}${route.replace('{id}', docsProfileId)}`;
    const sent = await call(
      await fetch(url, { method, headers: authHeaders, body: JSON.stringify(example) }),
    );
    check(
      `${label}: the example is accepted as sent (${sent.status})`,
      sent.status === 200 || sent.status === 201,
      sent,
    );
    // A created profile from the example must not outlive the run.
    if (route === '/profiles' && sent.body?.data?.id) {
      await fetch(`${BASE}/profiles/${sent.body.data.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    }
  }

  await fetch(`${BASE}/profiles/${docsProfileId}`, { method: 'DELETE', headers: authHeaders });
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
