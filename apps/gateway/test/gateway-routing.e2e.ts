/**
 * End-to-end tests for the API gateway's routing and edge-authentication rules.
 *
 * The gateway is the only process reachable from a browser, so it is the only
 * place these questions can be answered: which paths exist at all, who is
 * allowed through them, and what identity the request carries once it does. The
 * services behind it re-verify everything — that is deliberate defence in depth,
 * and it is also why a gateway defect is invisible from a service-level test.
 *
 * Real gateway, real auth-service, real PostgreSQL, real Redis — no mocks.
 * Requires:
 *   1. Postgres + Redis up, `longeny_core` schema pushed (bunx drizzle-kit push)
 *   2. gateway running on :3000, user-provider-service on :3002
 *   3. auth-service reachable on TEST_AUTH_BASE (default :3024) — the suite
 *      starts one itself if that port is free, and stops only that process.
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/gateway/test/gateway-routing.e2e.ts
 *
 * Re-runnable: every account id is minted fresh per run and the rows are removed
 * in teardown, so two consecutive runs assert on disjoint data.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 */
import crypto from 'node:crypto';
import { requestContext, requestCtx } from '@longeny/middleware';
import Elysia from 'elysia';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { optionalAuth } from '../src/middleware/optional-auth.js';

const GATEWAY = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const AUTH_BASE = process.env.TEST_AUTH_BASE ?? 'http://localhost:3024';
const AUTH_PORT = Number(process.env.TEST_AUTH_PORT ?? 3024);
/** Where the optional-auth probe app below binds. Nothing else uses this port. */
const PROBE_PORT = Number(process.env.TEST_PROBE_PORT ?? 3025);

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const CORE_DATABASE_URL = process.env.CORE_DATABASE_URL;
if (!JWT_SECRET || !CORE_DATABASE_URL) {
  console.error('JWT_ACCESS_SECRET / CORE_DATABASE_URL missing — did you `source .env`?');
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
}

async function call(res: Response): Promise<ApiResult> {
  const text = await res.text();
  try {
    return { status: res.status, headers: res.headers, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, headers: res.headers, body: text };
  }
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

const envelope = (body: unknown): Envelope => (body ?? {}) as Envelope;

interface ProfileRow {
  id: string;
  account_user_id: string;
  first_name: string;
  is_self: boolean;
}

const profileList = (body: unknown): ProfileRow[] => {
  const data = envelope(body).data;
  return Array.isArray(data) ? (data as ProfileRow[]) : [];
};

/**
 * Audit rows are written in `onAfterResponse`, i.e. after the response has been
 * flushed to us. Asserting on them the instant a fetch resolves is a race, so
 * every database assertion about a request that just happened polls briefly.
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
      email: `${sub}@gateway.test`,
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

const json = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...extra,
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Fresh accounts per run. A foreign token whose `users` row is missing 404s
// because the account does not exist, which would pass an identity check for the
// wrong reason — so both accounts are real rows.

const RUN = Date.now();
const CALLER_AUTH_ID = crypto.randomUUID();
const VICTIM_AUTH_ID = crypto.randomUUID();

const callerToken = mintToken(CALLER_AUTH_ID);
const adminToken = mintToken(crypto.randomUUID(), { role: 'admin', roles: ['admin'] });

const sql = postgres(CORE_DATABASE_URL);

for (const [authId, name] of [
  [CALLER_AUTH_ID, 'Caller'],
  [VICTIM_AUTH_ID, 'Victim'],
] as const) {
  await sql`
    INSERT INTO users (auth_id, email, first_name, last_name)
    VALUES (${authId}::uuid, ${`gw-${name.toLowerCase()}-${RUN}@longeny.test`}, ${name}, 'Gateway')
    ON CONFLICT (auth_id) DO NOTHING
  `;
}

// ── Preflight ────────────────────────────────────────────────────────────────
// The gateway's own limiter is per IP (RATE_LIMIT_MAX_REQUESTS/min) and this
// suite shares that budget with anything else pointed at the same gateway.
// Clearing the counter is setup, not a result: nothing below asserts on it.

await sql`SELECT 1`; // fail fast if Postgres is unreachable

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.status < 500 || res.status === 503; // 503 = gateway with services down
  } catch {
    return false;
  }
}

if (!(await reachable(GATEWAY))) {
  console.error(`Gateway not reachable at ${GATEWAY} — start it first.`);
  await sql.end();
  process.exit(1);
}

await Bun.$`docker exec w7redis redis-cli --raw EVAL ${'for _,k in ipairs(redis.call("KEYS", ARGV[1])) do redis.call("DEL", k) end return 1'} 0 ${'ratelimit:gateway:*'}`.quiet();

/**
 * auth-service is needed only by §4. If one is already listening it is left
 * alone; otherwise this suite starts its own and stops that PID in teardown.
 */
let spawnedAuth: ReturnType<typeof Bun.spawn> | null = null;
if (!(await reachable(AUTH_BASE))) {
  spawnedAuth = Bun.spawn(['bun', 'run', 'apps/auth-service/src/index.ts'], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: { ...process.env, AUTH_SERVICE_PORT: String(AUTH_PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !(await reachable(AUTH_BASE))) {
    await Bun.sleep(250);
  }
}

const authUp = await reachable(AUTH_BASE);

// ── 1. The authenticated surface ─────────────────────────────────────────────

console.log('\n1. /api/v1/profiles is reachable with a token and refused without one');

let r = await call(await fetch(`${GATEWAY}/api/v1/profiles`, { headers: json(callerToken) }));
check('200 with a valid token', r.status === 200, r.status);
check('returns this account’s profiles', profileList(r.body).length > 0, r.body);
const callerProfiles = profileList(r.body);
const callerSelfProfileId = callerProfiles.find((p) => p.is_self)?.id;
check('the account’s self profile came back', Boolean(callerSelfProfileId), callerProfiles);

r = await call(await fetch(`${GATEWAY}/api/v1/profiles`));
check('401 with no token', r.status === 401, r.status);
check('names the reason', envelope(r.body).error?.code === 'UNAUTHORIZED', r.body);

r = await call(
  await fetch(`${GATEWAY}/api/v1/profiles`, { headers: { Authorization: 'Bearer not-a-jwt' } }),
);
check('401 with a malformed token', r.status === 401, r.status);

// ── 2. /internal/* is not routed at all ──────────────────────────────────────
// Every internal route in the monorepo, spelled out. These authenticate with an
// HMAC signature rather than a JWT, so a caller who reached one through the
// gateway would be talking to the trust boundary the signature exists to draw.
// The gateway has no /api/v1/internal route, so the catch-all answers 404 —
// which is also the right answer: an existence oracle is a disclosure of its own.

console.log('\n2. /api/v1/internal/* is not exposed through the gateway');

const NON_EXISTENT_ID = '00000000-0000-0000-0000-000000000000';
const INTERNAL_PATHS: Array<[string, string]> = [
  ['GET', '/api/v1/internal/auth/verify'],
  ['GET', `/api/v1/internal/auth/consents/${NON_EXISTENT_ID}`],
  ['GET', `/api/v1/internal/gdpr/user-data/${NON_EXISTENT_ID}`],
  ['DELETE', `/api/v1/internal/gdpr/user-data/${NON_EXISTENT_ID}`],
  ['GET', `/api/v1/internal/users/by-auth/${NON_EXISTENT_ID}`],
  ['GET', `/api/v1/internal/users/${NON_EXISTENT_ID}`],
  ['GET', `/api/v1/internal/users/${NON_EXISTENT_ID}/health-profile`],
  ['GET', '/api/v1/internal/providers'],
  ['GET', `/api/v1/internal/providers/${NON_EXISTENT_ID}`],
  ['GET', `/api/v1/internal/providers/${NON_EXISTENT_ID}/full`],
  ['GET', `/api/v1/internal/providers/${NON_EXISTENT_ID}/availability`],
  ['POST', '/api/v1/internal/rro-state/transition'],
  ['POST', '/api/v1/internal/notify/profile'],
  ['POST', '/api/v1/internal/embeddings/generate'],
];

const reachedInternal: Array<{ method: string; path: string; status: number }> = [];
for (const [method, path] of INTERNAL_PATHS) {
  const res = await call(
    await fetch(`${GATEWAY}${path}`, {
      method,
      headers: json(callerToken),
      body: method === 'POST' ? JSON.stringify({ profileId: NON_EXISTENT_ID }) : undefined,
    }),
  );
  if (res.status !== 404) reachedInternal.push({ method, path, status: res.status });
}
check(
  `all ${INTERNAL_PATHS.length} internal paths answer 404 through the gateway`,
  reachedInternal.length === 0,
  reachedInternal,
);

// A signed request is the one an attacker would forge if they had the secret;
// the point is that the path does not exist regardless of what it carries.
r = await call(
  await fetch(`${GATEWAY}/api/v1/internal/providers`, {
    headers: {
      'X-Service-Name': 'gateway',
      'X-Timestamp': String(Date.now()),
      'X-Signature': 'deadbeef',
    },
  }),
);
check('404 even when the request carries HMAC headers', r.status === 404, r.status);

// ── 3. Identity headers cannot be forged ─────────────────────────────────────
// Downstream services read X-User-ID from the gateway. The gateway sets it from
// the verified token and deletes any inbound copy — otherwise the header is a
// login form with no password field.

console.log('\n3. Hand-set identity headers are not honoured');

// The account named in the forged header is a real one. Checked against the
// database rather than over HTTP on purpose: a request as the victim would write
// its own access-log row and blunt the "no row names the victim" assertions
// below. Without this, those assertions could pass because the identity does not
// exist rather than because the gateway refused to honour it.
const victimAccount = await sql<Array<{ id: string }>>`
  SELECT id FROM users WHERE auth_id = ${VICTIM_AUTH_ID}::uuid
`;
check('the account named in the forged header really exists', victimAccount.length === 1, {
  VICTIM_AUTH_ID,
});

const forgedHeaders = {
  'X-User-ID': VICTIM_AUTH_ID,
  'X-User-Email': `${VICTIM_AUTH_ID}@gateway.test`,
  'X-User-Role': 'admin',
  'Content-Type': 'application/json',
};

r = await call(await fetch(`${GATEWAY}/api/v1/profiles`, { headers: forgedHeaders }));
check('401 with no token but a hand-set X-User-ID / X-User-Role: admin', r.status === 401, r);

r = await call(await fetch(`${GATEWAY}/api/v1/admin/users`, { headers: forgedHeaders }));
check('401 on an admin path with the same forged headers', r.status === 401, r.status);

// Database-first: the forged actor must not appear in the health-data access log
// at all. A 401 at the gateway means the service was never called, so there is
// nothing to attribute — and if the header had been trusted, the row would name
// the victim.
const forgedRows = await sql<Array<{ count: string }>>`
  SELECT COUNT(*)::text AS count FROM phi_access_log WHERE actor_id = ${VICTIM_AUTH_ID}
`;
check(
  'no phi_access_log row was written for the forged account',
  forgedRows[0].count === '0',
  forgedRows[0],
);

// The stronger case: a request that IS authenticated, carrying someone else's id
// in the header. The gateway must overwrite it, not defer to it.
const forgeryCorrelationId = `gw-forgery-${RUN}`;
r = await call(
  await fetch(`${GATEWAY}/api/v1/profiles`, {
    headers: json(callerToken, {
      'X-User-ID': VICTIM_AUTH_ID,
      'X-User-Role': 'admin',
      'X-Correlation-ID': forgeryCorrelationId,
    }),
  }),
);
check('200 — the token decides, not the header', r.status === 200, r.status);
check(
  'the response is the token holder’s own data, not the header’s',
  profileList(r.body).every((p) => p.account_user_id === callerProfiles[0]?.account_user_id),
  profileList(r.body).map((p) => p.account_user_id),
);

// Wait for that request's own audit row before asserting the victim has none —
// otherwise "no row yet" and "no row ever" look the same.
const forgeryRows = await waitFor(
  () => sql<Array<{ actor_id: string }>>`
    SELECT actor_id FROM phi_access_log WHERE correlation_id = ${forgeryCorrelationId}
  `,
  (rows) => rows.length >= 1,
);
check(
  'the access log attributes it to the token holder',
  forgeryRows.length >= 1 && forgeryRows.every((row) => row.actor_id === CALLER_AUTH_ID),
  forgeryRows,
);
const attributedRows = await sql<Array<{ count: string }>>`
  SELECT COUNT(*)::text AS count FROM phi_access_log WHERE actor_id = ${VICTIM_AUTH_ID}
`;
check(
  'and no access-log row anywhere names the header’s account',
  attributedRows[0].count === '0',
  attributedRows[0],
);

// ── 4. optionalAuth checks revocation (M6) ───────────────────────────────────
// Signature verification alone accepts a token whose session has been logged
// out. These routes are public but personalised, so honouring a revoked token
// means serving one person's view to whoever holds their old token.
//
// The gateway's proxy exposes the decision only as a header it forwards
// downstream, and every service re-verifies the JWT itself — so the outcome is
// invisible from a proxied response. The real middleware is therefore mounted
// here on its own port and asked directly. Nothing is stubbed: the token is
// minted by a real auth-service, revoked by a real logout, and the revocation is
// read from the same Redis every service uses.

console.log('\n4. optionalAuth treats a revoked token as anonymous (M6)');

const probe = new Elysia()
  .use(requestContext())
  .use(optionalAuth())
  .get('/whoami', ({ request }) => ({ userId: requestCtx(request).userId }))
  .listen(PROBE_PORT);

if (!authUp) {
  check(`auth-service reachable at ${AUTH_BASE} (needed for the revocation check)`, false, {
    hint: `AUTH_SERVICE_PORT=${AUTH_PORT} bun run apps/auth-service/src/index.ts`,
  });
} else {
  const email = `gw-revoke-${RUN}@longeny.test`;
  const registered = await call(
    await fetch(`${AUTH_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'SecurePass123!',
        firstName: 'Revoked',
        lastName: 'Session',
      }),
    }),
  );
  const registeredData = envelope(registered.body).data as
    | { accessToken?: string; user?: { id?: string } }
    | undefined;
  const liveToken = registeredData?.accessToken ?? '';
  const liveUserId = registeredData?.user?.id ?? '';
  check(
    'auth-service issued a real access token',
    registered.status === 201 && Boolean(liveToken),
    {
      status: registered.status,
    },
  );

  const whoami = async (token?: string) => {
    const res = await call(
      await fetch(`http://localhost:${PROBE_PORT}/whoami`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    );
    return (res.body as { userId?: string }).userId ?? '';
  };

  check('before logout the token names its user', (await whoami(liveToken)) === liveUserId, {
    expected: liveUserId,
  });

  /**
   * auth-service applies its 5-per-15-minutes login limiter to every route
   * declared after `/login`, logout included, and keys it on the client IP —
   * which is the same `unknown` bucket for every local caller. A suite that has
   * to log out cannot share that budget, so on a 429 the bucket is cleared once
   * and the logout retried. Setup, not a result: nothing here asserts on it.
   */
  const logout = async () =>
    call(
      await fetch(`${AUTH_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${liveToken}` },
      }),
    );
  let loggedOut = await logout();
  if (loggedOut.status === 429) {
    await Bun.$`docker exec w7redis redis-cli --raw EVAL ${'for _,k in ipairs(redis.call("KEYS", ARGV[1])) do redis.call("DEL", k) end return 1'} 0 ${'ratelimit:login:*'}`.quiet();
    loggedOut = await logout();
  }
  check('logout succeeded', loggedOut.status === 200, loggedOut.body);

  const afterLogout = await whoami(liveToken);
  check(
    'after logout the same token is anonymous, not that user',
    afterLogout === '' && afterLogout !== liveUserId,
    { userId: afterLogout, wouldHaveBeen: liveUserId },
  );
  check('an unauthenticated request is anonymous too', (await whoami()) === '', {});

  // And the proxied route still serves the public view rather than erroring —
  // degrading to anonymous is the point, refusing the request is not.
  const publicRoute = await call(
    await fetch(`${GATEWAY}/api/v1/providers`, {
      headers: { Authorization: `Bearer ${liveToken}` },
    }),
  );
  check(
    '/api/v1/providers still answers 200 for the revoked token (anonymous view)',
    publicRoute.status === 200,
    publicRoute.status,
  );

  // Where the same token is used on a route that genuinely requires identity,
  // it is refused — the revocation is honoured end to end, not only at the edge.
  const savedItems = await call(
    await fetch(`${GATEWAY}/api/v1/marketplace/saved`, {
      headers: { Authorization: `Bearer ${liveToken}` },
    }),
  );
  check(
    '/api/v1/marketplace/saved refuses the revoked token (401)',
    savedItems.status === 401,
    savedItems.status,
  );
}

// ── 5. Admin-only proxy paths ────────────────────────────────────────────────

console.log('\n5. Admin proxy paths reject a patient token at the gateway');

for (const path of ['/api/v1/admin/users', '/api/v1/admin/dashboard', '/api/v1/admin/providers']) {
  const res = await call(await fetch(`${GATEWAY}${path}`, { headers: json(callerToken) }));
  check(`403 on ${path}`, res.status === 403, res.status);
}

r = await call(await fetch(`${GATEWAY}/api/v1/admin/users`, { headers: json(callerToken) }));
check(
  'the refusal names the required roles',
  String(envelope(r.body).error?.message).includes('admin'),
  r.body,
);

// The guard is a role check, not a blanket denial: an admin token gets past the
// gateway. What the service then does with it is the service's business.
r = await call(await fetch(`${GATEWAY}/api/v1/admin/users`, { headers: json(adminToken) }));
check('an admin token is not refused by the gateway guard', r.status !== 403, r.status);

// ── 6. The aggregated Swagger spec ───────────────────────────────────────────

console.log('\n6. /docs/json merges the downstream specs under /api/v1');

interface MergedSpec {
  openapi?: string;
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
  servers?: Array<{ url?: string }>;
}

const specRes = await fetch(`${GATEWAY}/docs/json`);
check('200 OK', specRes.status === 200, specRes.status);
const spec = (await specRes.json()) as MergedSpec;
const specPaths = Object.keys(spec.paths ?? {});

check('the spec is OpenAPI 3', String(spec.openapi).startsWith('3.'), spec.openapi);
check('it merged a non-trivial number of paths', specPaths.length > 20, specPaths.length);
check(
  'every path carries the /api/v1 gateway prefix',
  specPaths.every((p) => p.startsWith('/api/v1')),
  specPaths.filter((p) => !p.startsWith('/api/v1')),
);
check('the profile collection is documented', specPaths.includes('/api/v1/profiles'), specPaths);
check(
  'so are the per-profile paths',
  [
    '/api/v1/profiles/{id}',
    '/api/v1/profiles/{id}/consent',
    '/api/v1/profiles/{id}/rro-state',
  ].every((p) => specPaths.includes(p)),
  specPaths.filter((p) => p.startsWith('/api/v1/profiles')),
);
check(
  'user-provider paths merged with the service’s own prefix rewritten',
  specPaths.some((p) => p.startsWith('/api/v1/users/')) &&
    specPaths.some((p) => p.startsWith('/api/v1/providers')),
  specPaths.slice(0, 5),
);

/**
 * The auth spec is fetched from AUTH_SERVICE_URL, not from the port this suite
 * may have started for §4, and the merged spec is cached for a minute. So this
 * asserts the merger's contract either way: when auth answers, its paths appear
 * under /api/v1/auth; when it does not, the service is still named in the spec
 * as unreachable rather than silently dropped.
 */
const configuredAuthUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
const authPaths = specPaths.filter((p) => p.startsWith('/api/v1/auth/'));
const authTag = (spec.tags ?? []).find((t) => t.name === 'auth');
check(
  authPaths.length > 0
    ? 'a second downstream service (auth) merged under its own prefix'
    : `auth is unreachable at ${configuredAuthUrl} and the spec records it rather than dropping it`,
  authPaths.length > 0 || String(authTag?.description).includes('unreachable'),
  { authPaths: authPaths.length, authTag },
);

check(
  'the gateway injects its own BearerAuth security scheme into the merged spec',
  Object.keys(spec.components?.securitySchemes ?? {}).includes('BearerAuth'),
  Object.keys(spec.components?.securitySchemes ?? {}),
);
check(
  'downstream tags were carried over',
  (spec.tags ?? []).some((t) => t.name === 'Profiles'),
  (spec.tags ?? []).map((t) => t.name),
);

/**
 * DEFECT (open): the aggregated spec advertises the HMAC-only internal routes
 * under the gateway's own prefix and server URL, so the published contract tells
 * a reader that e.g. `DELETE /api/v1/internal/gdpr/user-data/{userId}` exists on
 * the public gateway. §2 above proves it does not — the doc is both wrong and a
 * map of the internal surface. `EXCLUDED_PATH_PATTERNS` in
 * apps/gateway/src/swagger.ts trims out-of-scope paths but has no `/internal/`
 * entry. This check is left failing on purpose until that pattern is added.
 */
const leakedInternal = specPaths.filter((p) => p.startsWith('/api/v1/internal/'));
check(
  'the public spec does not advertise the internal (HMAC-only) surface',
  leakedInternal.length === 0,
  leakedInternal,
);

// ── 7. Correlation id ────────────────────────────────────────────────────────
// A support ticket is traced by this id across five services. It has to survive
// the round trip, and it has to exist even when the caller does not send one.

console.log('\n7. X-Correlation-ID round-trips');

const correlationId = `gw-e2e-${RUN}-${crypto.randomUUID()}`;
r = await call(
  await fetch(`${GATEWAY}/api/v1/profiles`, {
    headers: json(callerToken, { 'X-Correlation-ID': correlationId }),
  }),
);
check('200 OK', r.status === 200, r.status);
check(
  'the response carries the id the caller sent',
  r.headers.get('X-Correlation-ID') === correlationId,
  r.headers.get('X-Correlation-ID'),
);

// It reached the service too, not just the response — the log row proves the
// whole hop, which is the only thing that makes the id worth having.
const correlatedRows = await waitFor(
  () => sql<Array<{ actor_id: string; path: string }>>`
    SELECT actor_id, path FROM phi_access_log WHERE correlation_id = ${correlationId}
  `,
  (rows) => rows.length >= 1,
);
check(
  'user-provider-service recorded the same id against the caller',
  correlatedRows.length >= 1 && correlatedRows.every((row) => row.actor_id === CALLER_AUTH_ID),
  correlatedRows,
);

r = await call(await fetch(`${GATEWAY}/api/v1/profiles`, { headers: json(callerToken) }));
check(
  'a request with no id is still given one',
  Boolean(r.headers.get('X-Correlation-ID')),
  r.headers.get('X-Correlation-ID'),
);

// ── Teardown ─────────────────────────────────────────────────────────────────
// The two accounts this run created, and nothing else. phi_access_log is
// append-only and deliberately survives: the rows are the record that these
// requests happened.

console.log('\nTeardown');
const accountIds = await sql<Array<{ id: string }>>`
  SELECT id FROM users WHERE auth_id IN (${CALLER_AUTH_ID}::uuid, ${VICTIM_AUTH_ID}::uuid)
`;
const ids = accountIds.map((row) => row.id);
if (ids.length > 0) {
  const profileIds = (
    await sql<Array<{ id: string }>>`
      SELECT id FROM profiles WHERE account_user_id IN ${sql(ids)}
    `
  ).map((row) => row.id);
  if (profileIds.length > 0) {
    await sql`DELETE FROM rro_transition WHERE profile_id IN ${sql(profileIds)}`;
    await sql`DELETE FROM rro_state WHERE profile_id IN ${sql(profileIds)}`;
    await sql`DELETE FROM profiles WHERE id IN ${sql(profileIds)}`;
  }
  await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
}
await sql.end();

probe.stop();
if (spawnedAuth) {
  spawnedAuth.kill();
  await spawnedAuth.exited;
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
