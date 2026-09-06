/**
 * End-to-end tests for auth-service: identity, RBAC escalation, revocation and
 * login hardening — the Week-6 audit findings H2, H3, H4, H5 and M8.
 *
 * Real service, real PostgreSQL, real Redis — no mocks, no stubs, no fixtures
 * that stand in for a service. Every write is confirmed by querying Postgres
 * directly rather than by trusting the HTTP response.
 *
 * Requires:
 *   1. Postgres (`longeny_auth`) and Redis up — docker `w7pg` :5434, `w7redis` :6380
 *   2. auth-service running on the port under TEST_BASE_URL (default :3021)
 *
 * Run:
 *   set -a; source .env; set +a
 *   cd apps/auth-service && AUTH_SERVICE_PORT=3021 bun run src/index.ts &
 *   bun run apps/auth-service/test/auth-rbac.e2e.ts
 *
 * §7 boots a second, short-lived instance of this service with GOOGLE_CLIENT_ID
 * unset, on the first free port it can claim. That is the only way to prove the
 * fail-closed guard without stubbing `fetch`, which this suite does not do.
 *
 * Every account, role and rate-limit bucket this suite touches is namespaced by
 * a per-run id, so consecutive runs never collide and a run that dies mid-way
 * cannot poison the next one. Teardown at the end removes everything it made.
 *
 * Two checks fail against the current build, both reproduced by hand outside
 * this file. They are product defects, not test bugs, and are left red on
 * purpose:
 *   §7  POST /auth/google with no request body answers 500 — `googleAuth` reads
 *       `params.idToken` off an undefined body. The route carries no schema.
 *   §8  The 5-per-15-minutes login limiter is a scoped hook installed part way
 *       down the auth router, so every route declared after it shares one
 *       budget: six reads of your own /auth/sessions in 15 minutes return 429.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 */
import crypto from 'node:crypto';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3021';
/** Candidate ports for the short-lived second instance §7 boots with no Google
 *  client id. Bun binds with SO_REUSEPORT, so a busy port would silently accept
 *  a second listener and hand half the probe's requests to somebody else's
 *  service — the port is claimed here first to prove it is genuinely free. */
const OAUTH_PROBE_PORTS = (process.env.TEST_OAUTH_PROBE_PORTS ?? '3921,3922,3923,3924')
  .split(',')
  .map((p) => Number(p.trim()));

const DATABASE_URL = process.env.AUTH_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('AUTH_DATABASE_URL missing — did you `source .env`?');
  process.exit(1);
}

/** Unique per run: emails, the probe role name and the rate-limit IPs all carry it. */
const RUN = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const PASSWORD = `E2e!${RUN}Aa1`;
const NEW_PASSWORD = `E2e!${RUN}Bb2`;
const SHRINK_ROLE = `e2e_shrink_${RUN}`;

// ── Types ────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

interface Res {
  status: number;
  body: Json;
}

interface AccessClaims {
  sub?: string;
  email?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  jti?: string;
  iat?: number;
  exp?: number;
}

interface Account {
  label: string;
  email: string;
  password: string;
  id: string;
  access: string;
  refresh: string;
}

interface RequestOptions {
  body?: unknown;
  token?: string;
  ip?: string;
}

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

function obj(value: unknown): Json {
  return value !== null && typeof value === 'object' ? (value as Json) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function data(res: Res): Json {
  return obj(res.body.data);
}

function errorCode(res: Res): string {
  return str(obj(res.body.error).code);
}

function claims(token: string): AccessClaims {
  const decoded: unknown = jwt.decode(token);
  return obj(decoded) as AccessClaims;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Every call presents its own source address unless the test pins one. The
 * login limiter is keyed on `X-Forwarded-For`, so sharing an address would make
 * unrelated sections spend each other's budget and turn timing into flakiness.
 * §8 pins addresses deliberately, because there the counter is the subject.
 */
async function request(method: string, path: string, opts: RequestOptions = {}): Promise<Res> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': opts.ip ?? nextIp(),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  let parsed: Json;
  try {
    parsed = obj(JSON.parse(text));
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

/**
 * `user_invalidated_before` has one-second resolution, so a token minted in the
 * same wall-clock second as the revocation compares equal and survives. The
 * tests wait out the issuing second before revoking so the assertion is about
 * the guard, not about how fast bcrypt happened to run.
 */
async function afterIssuingSecond(token: string): Promise<void> {
  const iat = claims(token).iat ?? 0;
  while (Math.floor(Date.now() / 1000) <= iat) {
    await Bun.sleep(120);
  }
}

// ── Preflight ────────────────────────────────────────────────────────────────

try {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (err) {
  console.error(`auth-service not reachable at ${BASE} — start it first.\n  ${err}`);
  process.exit(1);
}

const sql = postgres(DATABASE_URL);
const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const createdCredentialIds: string[] = [];
const usedIps: string[] = [];
const issuedJtis: string[] = [];

const ipOctet = crypto.randomBytes(1)[0];
let ipCounter = 0;

/** A fresh source address, remembered so teardown can drop its limiter key. */
function nextIp(): string {
  const n = ipCounter++;
  const ip = `10.${ipOctet}.${Math.floor(n / 256) % 256}.${n % 256}`;
  usedIps.push(ip);
  return ip;
}

function rememberToken(token: string): void {
  const jti = claims(token).jti;
  if (jti) issuedJtis.push(jti);
}

async function createAccount(label: string): Promise<Account> {
  const email = `e2e-rbac-${RUN}-${label}@longeny-test.local`;
  const res = await request('POST', '/auth/register', {
    body: { email, password: PASSWORD, firstName: 'E2E', lastName: label },
  });
  if (res.status !== 201) {
    throw new Error(`setup: register(${label}) returned ${res.status} ${JSON.stringify(res.body)}`);
  }
  const payload = data(res);
  const id = str(obj(payload.user).id);
  createdCredentialIds.push(id);
  const access = str(payload.accessToken);
  rememberToken(access);
  return { label, email, password: PASSWORD, id, access, refresh: str(payload.refreshToken) };
}

async function loginAs(account: Account, ip?: string): Promise<Res> {
  const res = await request('POST', '/auth/login', {
    ip,
    body: { email: account.email, password: account.password },
  });
  if (res.status === 200) {
    const payload = data(res);
    account.access = str(payload.accessToken);
    account.refresh = str(payload.refreshToken);
    rememberToken(account.access);
  }
  return res;
}

/** Roles set straight in the database — the state the service must read back. */
async function setRolesDirect(credentialId: string, roleNames: string[]): Promise<void> {
  await sql`DELETE FROM user_roles WHERE credential_id = ${credentialId}::uuid`;
  for (const name of roleNames) {
    await sql`
      INSERT INTO user_roles (credential_id, role_id)
      SELECT ${credentialId}::uuid, id FROM roles WHERE name = ${name}
    `;
  }
}

async function roleNamesOf(credentialId: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT r.name FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.credential_id = ${credentialId}::uuid
    ORDER BY r.name
  `;
  return rows.map((r) => r.name);
}

const roleIdRows = await sql<{ id: string; name: string }[]>`SELECT id, name FROM roles`;
const roleId = new Map(roleIdRows.map((r) => [r.name, r.id]));
const USER_ROLE_ID = roleId.get('user') ?? '';
const PROVIDER_ROLE_ID = roleId.get('provider') ?? '';
const ADMIN_ROLE_ID = roleId.get('admin') ?? '';
const SUPER_ADMIN_ROLE_ID = roleId.get('super_admin') ?? '';
if (!USER_ROLE_ID || !PROVIDER_ROLE_ID || !ADMIN_ROLE_ID || !SUPER_ADMIN_ROLE_ID) {
  console.error('setup: the four system roles are not seeded — run `bun run db:seed` first.');
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n### auth-service RBAC / revocation E2E — run ${RUN} against ${BASE}`);

console.log('\n1. Register → login → refresh, verified in the database');

const alpha = await createAccount('alpha');

const credRows = await sql<
  { id: string; password_hash: string | null; status: string; email_verified: boolean }[]
>`
  SELECT id, password_hash, status, email_verified FROM credentials WHERE email = ${alpha.email}
`;
check('credentials row exists after register', credRows.length === 1, credRows.length);
const credRow = credRows[0];
check('row id matches the id the API returned', credRow?.id === alpha.id, {
  db: credRow?.id,
  api: alpha.id,
});
check(
  'password is not stored in plaintext',
  credRow?.password_hash !== null && credRow?.password_hash !== PASSWORD,
  { storedLooksLikePlaintext: credRow?.password_hash === PASSWORD },
);
check(
  'password_hash is a bcrypt digest',
  typeof credRow?.password_hash === 'string' && /^\$2[aby]?\$\d{2}\$/.test(credRow.password_hash),
  credRow?.password_hash?.slice(0, 7),
);
check(
  'no column on the row leaks the plaintext',
  !JSON.stringify(credRow ?? {}).includes(PASSWORD),
  Object.keys(credRow ?? {}),
);

check('a user_roles row was created', (await roleNamesOf(alpha.id)).join(',') === 'user', {
  roles: await roleNamesOf(alpha.id),
});

const registerAudit = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM audit_logs
  WHERE credential_id = ${alpha.id}::uuid AND action = 'register' AND result = 'success'
`;
check('registration is audited', (registerAudit[0]?.n ?? 0) >= 1, registerAudit[0]);

const registerClaims = claims(alpha.access);
check('access token carries roles: []', Array.isArray(registerClaims.roles), registerClaims.roles);
check(
  'access token carries permissions: []',
  Array.isArray(registerClaims.permissions),
  typeof registerClaims.permissions,
);
check('roles claim is ["user"]', (registerClaims.roles ?? []).join(',') === 'user', {
  roles: registerClaims.roles,
});
check(
  'permissions claim is populated, not an empty stand-in',
  (registerClaims.permissions ?? []).length > 0,
  registerClaims.permissions,
);
check('legacy single `role` claim is still present', registerClaims.role === 'user', {
  role: registerClaims.role,
});
check('token carries a jti', typeof registerClaims.jti === 'string', registerClaims.jti);

const loginRes = await loginAs(alpha);
check('login returns 200', loginRes.status === 200, loginRes.body);
check(
  'login token carries the same roles and permissions shape',
  Array.isArray(claims(alpha.access).roles) && Array.isArray(claims(alpha.access).permissions),
  claims(alpha.access),
);

const sessionRows = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM sessions
  WHERE credential_id = ${alpha.id}::uuid AND is_active = true
`;
check('login created a second active session row', (sessionRows[0]?.n ?? 0) === 2, sessionRows[0]);

const oldRefresh = alpha.refresh;
const refreshRes = await request('POST', '/auth/refresh', {
  body: { refreshToken: oldRefresh },
});
check('refresh returns 200', refreshRes.status === 200, refreshRes.body);
const rotated = str(data(refreshRes).accessToken);
alpha.refresh = str(data(refreshRes).refreshToken);
rememberToken(rotated);
check('refresh issued a different access token', rotated !== alpha.access && rotated.length > 0);
check(
  'refreshed token still carries roles and permissions',
  (claims(rotated).roles ?? []).join(',') === 'user' &&
    (claims(rotated).permissions ?? []).length > 0,
  claims(rotated),
);

const rotatedSession = await sql<{ is_active: boolean; revoked_at: Date | null }[]>`
  SELECT is_active, revoked_at FROM sessions WHERE refresh_token_hash = ${sha256(oldRefresh)}
`;
check(
  'the rotated-out session is revoked in the database',
  rotatedSession[0]?.is_active === false && rotatedSession[0]?.revoked_at !== null,
  rotatedSession[0],
);

const replay = await request('POST', '/auth/refresh', {
  body: { refreshToken: oldRefresh },
});
check('replaying the old refresh token is refused', replay.status === 401, replay.status);

console.log('\n2. Multi-role identity — both roles and the union of permissions reach the token');

const bravo = await createAccount('bravo');
await setRolesDirect(bravo.id, ['user', 'provider']);
const bravoLogin = await loginAs(bravo);
check('login with two roles returns 200', bravoLogin.status === 200, bravoLogin.body);

const bravoClaims = claims(bravo.access);
check(
  'token lists both roles, highest privilege first',
  (bravoClaims.roles ?? []).join(',') === 'provider,user',
  {
    roles: bravoClaims.roles,
  },
);
check('primary `role` claim is the higher-privilege one', bravoClaims.role === 'provider', {
  role: bravoClaims.role,
});

const unionRows = await sql<{ name: string }[]>`
  SELECT DISTINCT p.name FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE ur.credential_id = ${bravo.id}::uuid
  ORDER BY p.name
`;
const expectedUnion = unionRows.map((r) => r.name);
const tokenPermissions = [...(bravoClaims.permissions ?? [])].sort();
check(
  'permissions are the union of both roles, exactly as the database has them',
  tokenPermissions.join('|') === expectedUnion.join('|'),
  { token: tokenPermissions.length, db: expectedUnion.length },
);

const providerOnly = await sql<{ name: string }[]>`
  SELECT p.name FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = ${PROVIDER_ROLE_ID}::uuid
    AND p.id NOT IN (
      SELECT permission_id FROM role_permissions WHERE role_id = ${USER_ROLE_ID}::uuid
    )
`;
check(
  'a permission only the second role grants is present — the first role did not win alone',
  providerOnly.length > 0 && providerOnly.every((p) => tokenPermissions.includes(p.name)),
  { providerOnly: providerOnly.map((p) => p.name) },
);

console.log('\n3. Permissions shrink on refresh');

const spare = await sql<{ id: string; name: string }[]>`
  SELECT id, name FROM permissions
  WHERE id NOT IN (SELECT permission_id FROM role_permissions WHERE role_id = ${USER_ROLE_ID}::uuid)
  ORDER BY name
  LIMIT 2
`;
if (spare.length !== 2) {
  console.error('setup: fewer than two permissions outside the `user` role — cannot run §3.');
  process.exit(1);
}
const [droppedPerm, keptPerm] = spare;

const shrinkRoleRows = await sql<{ id: string }[]>`
  INSERT INTO roles (name, description, is_system)
  VALUES (${SHRINK_ROLE}, 'e2e permission-shrink probe', false)
  RETURNING id
`;
const shrinkRoleId = shrinkRoleRows[0]?.id ?? '';
await sql`
  INSERT INTO role_permissions (role_id, permission_id)
  VALUES (${shrinkRoleId}::uuid, ${droppedPerm.id}::uuid),
         (${shrinkRoleId}::uuid, ${keptPerm.id}::uuid)
`;

const charlie = await createAccount('charlie');
await sql`
  INSERT INTO user_roles (credential_id, role_id)
  VALUES (${charlie.id}::uuid, ${shrinkRoleId}::uuid)
`;
const charlieLogin = await loginAs(charlie);
check('login with the probe role returns 200', charlieLogin.status === 200, charlieLogin.body);
check(
  'both probe permissions are on the token',
  (claims(charlie.access).permissions ?? []).includes(droppedPerm.name) &&
    (claims(charlie.access).permissions ?? []).includes(keptPerm.name),
  { granted: [droppedPerm.name, keptPerm.name] },
);

await sql`
  DELETE FROM role_permissions
  WHERE role_id = ${shrinkRoleId}::uuid AND permission_id = ${droppedPerm.id}::uuid
`;

const shrunk = await request('POST', '/auth/refresh', {
  body: { refreshToken: charlie.refresh },
});
check('refresh after the permission was removed returns 200', shrunk.status === 200, shrunk.body);
charlie.refresh = str(data(shrunk).refreshToken);
const shrunkPermissions = claims(str(data(shrunk).accessToken)).permissions ?? [];
rememberToken(str(data(shrunk).accessToken));
check(
  'the removed permission is gone from the refreshed token',
  !shrunkPermissions.includes(droppedPerm.name),
  { removed: droppedPerm.name, stillPresent: shrunkPermissions.includes(droppedPerm.name) },
);
check('the untouched permission survived the refresh', shrunkPermissions.includes(keptPerm.name), {
  kept: keptPerm.name,
});

await sql`
  INSERT INTO role_permissions (role_id, permission_id)
  VALUES (${shrinkRoleId}::uuid, ${droppedPerm.id}::uuid)
`;
const restored = await request('POST', '/auth/refresh', {
  body: { refreshToken: charlie.refresh },
});
charlie.refresh = str(data(restored).refreshToken);
rememberToken(str(data(restored).accessToken));
check(
  'restoring the permission puts it back on the next refresh',
  (claims(str(data(restored).accessToken)).permissions ?? []).includes(droppedPerm.name),
  { restored: droppedPerm.name },
);

console.log('\n4. PUT /auth/users/:userId/roles — privilege escalation is blocked (H4)');

const adminA = await createAccount('admin');
await setRolesDirect(adminA.id, ['admin']);
await loginAs(adminA);

const superS = await createAccount('superadmin');
await setRolesDirect(superS.id, ['super_admin']);
await loginAs(superS);

const targetT = await createAccount('target');
const superV = await createAccount('supervictim');
await setRolesDirect(superV.id, ['super_admin']);
const targetU = await createAccount('target2');

const selfEscalate = await request('PUT', `/auth/users/${adminA.id}/roles`, {
  token: adminA.access,
  body: { roleIds: [SUPER_ADMIN_ROLE_ID] },
});
check('admin granting itself super_admin → 403', selfEscalate.status === 403, selfEscalate.body);
check(
  'admin still holds only `admin` in the database',
  (await roleNamesOf(adminA.id)).join(',') === 'admin',
  await roleNamesOf(adminA.id),
);

const grantSuper = await request('PUT', `/auth/users/${targetT.id}/roles`, {
  token: adminA.access,
  body: { roleIds: [SUPER_ADMIN_ROLE_ID] },
});
check('admin granting another user super_admin → 403', grantSuper.status === 403, grantSuper.body);
check(
  'the target did not gain super_admin in the database',
  !(await roleNamesOf(targetT.id)).includes('super_admin'),
  await roleNamesOf(targetT.id),
);

const stripSuper = await request('PUT', `/auth/users/${superV.id}/roles`, {
  token: adminA.access,
  body: { roleIds: [USER_ROLE_ID] },
});
check('admin stripping a super_admin → 403', stripSuper.status === 403, stripSuper.body);
check(
  'the super_admin kept its role in the database',
  (await roleNamesOf(superV.id)).join(',') === 'super_admin',
  await roleNamesOf(superV.id),
);

const grantProvider = await request('PUT', `/auth/users/${targetT.id}/roles`, {
  token: adminA.access,
  body: { roleIds: [PROVIDER_ROLE_ID] },
});
check(
  'admin granting `provider` to another user → 200',
  grantProvider.status === 200,
  grantProvider.body,
);
check(
  'the grant is in the database',
  (await roleNamesOf(targetT.id)).join(',') === 'provider',
  await roleNamesOf(targetT.id),
);

const grantAdmin = await request('PUT', `/auth/users/${targetU.id}/roles`, {
  token: superS.access,
  body: { roleIds: [ADMIN_ROLE_ID] },
});
check('super_admin granting `admin` → 200', grantAdmin.status === 200, grantAdmin.body);
check(
  'the admin grant is in the database',
  (await roleNamesOf(targetU.id)).join(',') === 'admin',
  await roleNamesOf(targetU.id),
);

const superSelf = await request('PUT', `/auth/users/${superS.id}/roles`, {
  token: superS.access,
  body: { roleIds: [SUPER_ADMIN_ROLE_ID, ADMIN_ROLE_ID] },
});
check('super_admin changing its own roles → 403', superSelf.status === 403, superSelf.body);
check(
  'super_admin roles unchanged in the database',
  (await roleNamesOf(superS.id)).join(',') === 'super_admin',
  await roleNamesOf(superS.id),
);

const noAuthRoleChange = await request('PUT', `/auth/users/${targetT.id}/roles`, {
  token: alpha.access,
  body: { roleIds: [ADMIN_ROLE_ID] },
});
check(
  'a plain user cannot reach the endpoint at all → 403',
  noAuthRoleChange.status === 403,
  noAuthRoleChange.body,
);

const successAudit = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM audit_logs
  WHERE credential_id = ${adminA.id}::uuid
    AND event_type = 'rbac.user.roles.changed'
    AND result = 'success'
    AND resource_id = ${targetT.id}::uuid
`;
check(
  'the successful role change left an audit row',
  (successAudit[0]?.n ?? 0) >= 1,
  successAudit[0],
);

const deniedAudit = await sql<{ n: number; reasons: string[] }[]>`
  SELECT count(*)::int AS n, array_agg(metadata->>'reason') AS reasons FROM audit_logs
  WHERE credential_id = ${adminA.id}::uuid
    AND event_type = 'rbac.user.roles.denied'
    AND result = 'denied'
`;
check('every refusal left an audit row', (deniedAudit[0]?.n ?? 0) >= 3, deniedAudit[0]);
check(
  'the refusal rows name why they were refused',
  (deniedAudit[0]?.reasons ?? []).includes('self_role_change') &&
    (deniedAudit[0]?.reasons ?? []).some((r) => r?.startsWith('role_above_actor:super_admin')),
  deniedAudit[0]?.reasons,
);

console.log('\n5. PUT /auth/roles/:id/permissions is super_admin only');

const adminReadsRole = await request('GET', `/auth/roles/${shrinkRoleId}/permissions`, {
  token: adminA.access,
});
check('admin GET role permissions → 200', adminReadsRole.status === 200, adminReadsRole.body);
check(
  'the GET returns the role and its permissions',
  str(obj(data(adminReadsRole).role).id) === shrinkRoleId &&
    Array.isArray(data(adminReadsRole).permissions),
  data(adminReadsRole).role,
);

const adminWritesRole = await request('PUT', `/auth/roles/${shrinkRoleId}/permissions`, {
  token: adminA.access,
  body: { permissionIds: [droppedPerm.id, keptPerm.id, ADMIN_ROLE_ID] },
});
check('admin PUT role permissions → 403', adminWritesRole.status === 403, adminWritesRole.body);
check(
  'the 403 is a role refusal',
  errorCode(adminWritesRole) === 'FORBIDDEN',
  adminWritesRole.body,
);

const permsAfterRefusal = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM role_permissions WHERE role_id = ${shrinkRoleId}::uuid
`;
check(
  'the refused write changed nothing in the database',
  (permsAfterRefusal[0]?.n ?? 0) === 2,
  permsAfterRefusal[0],
);

const superWritesRole = await request('PUT', `/auth/roles/${shrinkRoleId}/permissions`, {
  token: superS.access,
  body: { permissionIds: [keptPerm.id] },
});
check(
  'super_admin PUT role permissions → 200',
  superWritesRole.status === 200,
  superWritesRole.body,
);

const permsAfterWrite = await sql<{ permission_id: string }[]>`
  SELECT permission_id FROM role_permissions WHERE role_id = ${shrinkRoleId}::uuid
`;
check(
  'the super_admin write landed in the database',
  permsAfterWrite.length === 1 && permsAfterWrite[0]?.permission_id === keptPerm.id,
  permsAfterWrite,
);

console.log('\n6. Revocation on privilege and credential change (H5)');

const victimRole = await createAccount('victim-role');
await loginAs(victimRole);
const beforeRoleChange = await request('GET', '/auth/sessions', {
  token: victimRole.access,
});
check(
  'victim token works before the role change',
  beforeRoleChange.status === 200,
  beforeRoleChange.body,
);

await afterIssuingSecond(victimRole.access);
const roleChange = await request('PUT', `/auth/users/${victimRole.id}/roles`, {
  token: adminA.access,
  body: { roleIds: [PROVIDER_ROLE_ID] },
});
check('admin changes the victim’s roles → 200', roleChange.status === 200, roleChange.body);

const afterRoleChange = await request('GET', '/auth/sessions', {
  token: victimRole.access,
});
check(
  'the pre-change access token is now 401',
  afterRoleChange.status === 401,
  afterRoleChange.body,
);
check('…with TOKEN_REVOKED', errorCode(afterRoleChange) === 'TOKEN_REVOKED', afterRoleChange.body);

const refreshAfterRoleChange = await request('POST', '/auth/refresh', {
  body: { refreshToken: victimRole.refresh },
});
check(
  'the victim’s refresh token is refused too',
  refreshAfterRoleChange.status === 401,
  refreshAfterRoleChange.body,
);

const roleChangeSessions = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM sessions
  WHERE credential_id = ${victimRole.id}::uuid AND is_active = true
`;
check(
  'no active session rows survive the role change',
  (roleChangeSessions[0]?.n ?? -1) === 0,
  roleChangeSessions[0],
);

const victimPassword = await createAccount('victim-password');
await loginAs(victimPassword);
const beforePasswordChange = await request('GET', '/auth/sessions', {
  token: victimPassword.access,
});
check(
  'victim token works before change-password',
  beforePasswordChange.status === 200,
  beforePasswordChange.body,
);

await afterIssuingSecond(victimPassword.access);
const changePassword = await request('POST', '/auth/change-password', {
  token: victimPassword.access,
  body: { currentPassword: victimPassword.password, newPassword: NEW_PASSWORD },
});
check('change-password → 200', changePassword.status === 200, changePassword.body);
victimPassword.password = NEW_PASSWORD;

const afterPasswordChange = await request('GET', '/auth/sessions', {
  token: victimPassword.access,
});
check(
  'the pre-change access token is now 401',
  afterPasswordChange.status === 401,
  afterPasswordChange.body,
);
check(
  '…with TOKEN_REVOKED',
  errorCode(afterPasswordChange) === 'TOKEN_REVOKED',
  afterPasswordChange.body,
);

const refreshAfterPasswordChange = await request('POST', '/auth/refresh', {
  body: { refreshToken: victimPassword.refresh },
});
check(
  'the refresh token is refused after change-password',
  refreshAfterPasswordChange.status === 401,
  refreshAfterPasswordChange.body,
);

const changedHash = await sql<
  { password_hash: string | null; last_password_change: Date | null }[]
>`
  SELECT password_hash, last_password_change FROM credentials WHERE id = ${victimPassword.id}::uuid
`;
check(
  'the new password hash is stored and dated',
  changedHash[0]?.password_hash !== credRow?.password_hash &&
    changedHash[0]?.last_password_change !== null,
  { dated: changedHash[0]?.last_password_change !== null },
);

const victimReset = await createAccount('victim-reset');
await loginAs(victimReset);
const beforeReset = await request('GET', '/auth/sessions', {
  token: victimReset.access,
});
check('victim token works before reset-password', beforeReset.status === 200, beforeReset.body);

const forgot = await request('POST', '/auth/forgot-password', {
  body: { email: victimReset.email },
});
check('forgot-password → 200', forgot.status === 200, forgot.body);

const resetTokenRows = await sql<{ password_reset_token: string | null }[]>`
  SELECT password_reset_token FROM credentials WHERE id = ${victimReset.id}::uuid
`;
const resetToken = resetTokenRows[0]?.password_reset_token ?? '';
check('a reset token was stored on the credential', resetToken.length > 0);

await afterIssuingSecond(victimReset.access);
const reset = await request('POST', '/auth/reset-password', {
  body: { token: resetToken, password: NEW_PASSWORD },
});
check('reset-password → 200', reset.status === 200, reset.body);
victimReset.password = NEW_PASSWORD;

const afterReset = await request('GET', '/auth/sessions', {
  token: victimReset.access,
});
check('the pre-reset access token is now 401', afterReset.status === 401, afterReset.body);
check('…with TOKEN_REVOKED', errorCode(afterReset) === 'TOKEN_REVOKED', afterReset.body);

const refreshAfterReset = await request('POST', '/auth/refresh', {
  body: { refreshToken: victimReset.refresh },
});
check(
  'the refresh token is refused after reset-password',
  refreshAfterReset.status === 401,
  refreshAfterReset.body,
);

const resetRow = await sql<{ password_reset_token: string | null; active: number }[]>`
  SELECT c.password_reset_token,
         (SELECT count(*)::int FROM sessions s
          WHERE s.credential_id = c.id AND s.is_active = true) AS active
  FROM credentials c WHERE c.id = ${victimReset.id}::uuid
`;
check(
  'the reset token is consumed and every session is revoked',
  resetRow[0]?.password_reset_token === null && resetRow[0]?.active === 0,
  resetRow[0],
);

const revocationKey = await redis.get(`user_invalidated_before:${victimReset.id}`);
check('Redis holds the per-user invalidation stamp', revocationKey !== null, revocationKey);

console.log('\n7. OAuth guards (H2)');

const oauthNoParams = await request('POST', '/auth/google', { ip: nextIp(), body: {} });
check(
  'a request carrying neither idToken nor code is rejected',
  oauthNoParams.status >= 400 && oauthNoParams.status < 500,
  oauthNoParams,
);
check(
  'the refusal names the missing parameter',
  // The parameter names live in error.details.fields — the error handler reports
  // which fields failed and why, without echoing what was sent. The top-level
  // message stays the same for every validated route in the repo.
  JSON.stringify(obj(oauthNoParams.body.error).details ?? {}).includes('idToken'),
  oauthNoParams.body,
);

const oauthNoBody = await fetch(`${BASE}/auth/google`, {
  method: 'POST',
  headers: { 'X-Forwarded-For': nextIp() },
});
check(
  'a request with no body at all is rejected with a client error, not a 500',
  oauthNoBody.status >= 400 && oauthNoBody.status < 500,
  { status: oauthNoBody.status },
);

// Fail-closed with no configured audience: a second instance is booted with
// GOOGLE_CLIENT_ID unset and asked to accept an id_token. It must refuse before
// it ever reaches Google — the check that H2 added.
function portIsFree(port: number): boolean {
  try {
    const socket = Bun.listen({ hostname: '0.0.0.0', port, socket: { data() {} } });
    socket.stop(true);
    return true;
  } catch {
    return false;
  }
}

const probePort = OAUTH_PROBE_PORTS.find(portIsFree) ?? 0;
check('a free port was found for the no-client-id instance', probePort !== 0, OAUTH_PROBE_PORTS);

const probe = Bun.spawn(['bun', 'run', 'src/index.ts'], {
  cwd: `${import.meta.dir}/..`,
  env: { ...process.env, GOOGLE_CLIENT_ID: '', AUTH_SERVICE_PORT: String(probePort) },
  stdout: 'ignore',
  stderr: 'ignore',
});

let probeUp = false;
for (let attempt = 0; attempt < 60 && !probeUp && probePort !== 0; attempt++) {
  await Bun.sleep(250);
  try {
    const health = await fetch(`http://localhost:${probePort}/health`);
    probeUp = health.ok;
  } catch {
    probeUp = false;
  }
}
check(`a second instance with GOOGLE_CLIENT_ID unset booted on :${probePort}`, probeUp);

if (probeUp) {
  const failClosed = await fetch(`http://localhost:${probePort}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: `unsigned.${RUN}.token` }),
  });
  const failClosedBody = obj(await failClosed.json());
  check(
    'with no configured audience the OAuth endpoint fails closed (503), it does not accept the token',
    failClosed.status === 503,
    { status: failClosed.status, body: failClosedBody },
  );
  check(
    'the refusal is SERVICE_UNAVAILABLE, and no tokens are returned',
    str(obj(failClosedBody.error).code) === 'SERVICE_UNAVAILABLE' &&
      obj(failClosedBody.data).accessToken === undefined,
    failClosedBody,
  );

  const oauthCreated = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM oauth_accounts WHERE provider_email LIKE ${`%${RUN}%`}
  `;
  check(
    'the refused OAuth attempt created no linked account',
    (oauthCreated[0]?.n ?? 0) === 0,
    oauthCreated[0],
  );
}

probe.kill();
await probe.exited;

console.log('\n8. Login hardening — failed attempts, lockout, rate limit');

const locked = await createAccount('lockout');
const lockoutIp = nextIp();
const lockedOutIp = nextIp();

const firstFailure = await request('POST', '/auth/login', {
  ip: lockoutIp,
  body: { email: locked.email, password: 'WrongPass!1' },
});
check('a wrong password returns 401', firstFailure.status === 401, firstFailure.body);

const afterOne = await sql<{ failed_login_attempts: number }[]>`
  SELECT failed_login_attempts FROM credentials WHERE id = ${locked.id}::uuid
`;
check(
  'failed_login_attempts incremented to 1 in the database',
  afterOne[0]?.failed_login_attempts === 1,
  afterOne[0],
);

for (let attempt = 2; attempt <= 5; attempt++) {
  await request('POST', '/auth/login', {
    ip: lockoutIp,
    body: { email: locked.email, password: 'WrongPass!1' },
  });
}

const afterFive = await sql<
  { failed_login_attempts: number; status: string; locked_until: Date | null }[]
>`
  SELECT failed_login_attempts, status, locked_until FROM credentials WHERE id = ${locked.id}::uuid
`;
check(
  'five failures counted in the database',
  afterFive[0]?.failed_login_attempts === 5,
  afterFive[0],
);
check('the account status is `locked`', afterFive[0]?.status === 'locked', afterFive[0]?.status);
check(
  'locked_until is set in the future',
  (afterFive[0]?.locked_until?.getTime() ?? 0) > Date.now(),
  afterFive[0]?.locked_until,
);

const failureAudit = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM audit_logs
  WHERE credential_id = ${locked.id}::uuid AND event_type = 'user.login.failed' AND result = 'failure'
`;
check('all five failures are audited', (failureAudit[0]?.n ?? 0) === 5, failureAudit[0]);

// From a fresh address so the login limiter is not what answers.
const lockedOut = await request('POST', '/auth/login', {
  ip: lockedOutIp,
  body: { email: locked.email, password: PASSWORD },
});
check('the correct password is refused while locked → 423', lockedOut.status === 423, lockedOut);
check('…with ACCOUNT_LOCKED', errorCode(lockedOut) === 'ACCOUNT_LOCKED', lockedOut.body);

const lockAudit = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM audit_logs
  WHERE credential_id = ${locked.id}::uuid AND event_type = 'user.login.locked' AND result = 'denied'
`;
check('the lockout itself is audited', (lockAudit[0]?.n ?? 0) >= 1, lockAudit[0]);

const limitedAccount = await createAccount('ratelimit');
const limitedIp = nextIp();
const limitStatuses: number[] = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  const res = await request('POST', '/auth/login', {
    ip: limitedIp,
    body: { email: limitedAccount.email, password: 'WrongPass!1' },
  });
  limitStatuses.push(res.status);
}
check(
  'the first five attempts are answered by auth, not by the limiter',
  limitStatuses.slice(0, 5).every((s) => s === 401),
  limitStatuses,
);
check('the sixth attempt in the window returns 429', limitStatuses[5] === 429, limitStatuses);

const limiterKey = await redis.get(`ratelimit:login:ip:${limitedIp}`);
check('the limiter counter is in Redis', Number(limiterKey ?? 0) >= 6, limiterKey);

// The login limiter must count logins. It is registered as a scoped hook part
// way down the auth router, so every route declared after it — refresh, logout,
// sessions, consents, change-password, the OAuth routes — shares the same
// 5-per-15-minutes budget keyed on the caller's address.
const budgetHolder = await createAccount('limiter-scope');
await loginAs(budgetHolder);
const sharedIp = nextIp();
const sessionStatuses: number[] = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  const res = await request('GET', '/auth/sessions', { token: budgetHolder.access, ip: sharedIp });
  sessionStatuses.push(res.status);
}
check(
  'the login limiter does not spend the budget of unrelated auth routes',
  sessionStatuses.every((s) => s === 200),
  { 'GET /auth/sessions x6 from one address': sessionStatuses },
);

console.log('\n9. Logout blacklists the access token');

const bye = await createAccount('logout');
await loginAs(bye);
const beforeLogout = await request('GET', '/auth/sessions', { token: bye.access });
check('the token works before logout', beforeLogout.status === 200, beforeLogout.body);

const logout = await request('POST', '/auth/logout', { token: bye.access });
check('logout → 200', logout.status === 200, logout.body);

const afterLogout = await request('GET', '/auth/sessions', { token: bye.access });
check('the logged-out access token is now 401', afterLogout.status === 401, afterLogout.body);
check('…with TOKEN_REVOKED', errorCode(afterLogout) === 'TOKEN_REVOKED', afterLogout.body);

const byeJti = claims(bye.access).jti ?? '';
const blacklistValue = await redis.get(`blacklist:${byeJti}`);
const blacklistTtl = await redis.ttl(`blacklist:${byeJti}`);
check('the jti is blacklisted in Redis', blacklistValue !== null, { jti: byeJti, blacklistValue });
check(
  'the blacklist entry expires with the token, not never',
  blacklistTtl > 0 && blacklistTtl <= 900,
  blacklistTtl,
);

// ── Teardown ─────────────────────────────────────────────────────────────────

for (const jti of issuedJtis) {
  if (jti) await redis.del(`blacklist:${jti}`);
}
for (const id of createdCredentialIds) {
  await redis.del(`user_invalidated_before:${id}`);
}
for (const ip of usedIps) {
  await redis.del(`ratelimit:login:ip:${ip}`);
}

const ids = createdCredentialIds;
if (ids.length > 0) {
  await sql`DELETE FROM sessions WHERE credential_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM user_roles WHERE credential_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM oauth_accounts WHERE credential_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM consents WHERE credential_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM audit_logs WHERE credential_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM audit_logs WHERE resource_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM credentials WHERE id = ANY(${ids}::uuid[])`;
}
await sql`DELETE FROM role_permissions WHERE role_id = ${shrinkRoleId}::uuid`;
await sql`DELETE FROM roles WHERE id = ${shrinkRoleId}::uuid`;

const leftovers = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM credentials WHERE email LIKE ${`e2e-rbac-${RUN}-%`}
`;
check(
  'teardown removed every account this run created',
  (leftovers[0]?.n ?? -1) === 0,
  leftovers[0],
);

await sql.end();
redis.disconnect();

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
