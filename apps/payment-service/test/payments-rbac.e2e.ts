/**
 * End-to-end tests for payment-service authorization, request validation and
 * row-level ownership.
 *
 * Real service, real PostgreSQL — no mocks, no stubs. Requires:
 *   1. Postgres up with the `longeny_payments` schema pushed (bunx drizzle-kit push)
 *   2. payment-service running (default :3022 — a spare port, so it never
 *      collides with the :3005 instance a developer may already have running)
 *
 * Run:
 *   set -a; source .env; set +a
 *   PAYMENT_SERVICE_PORT=3022 bun run apps/payment-service/src/index.ts &
 *   bun run apps/payment-service/test/payments-rbac.e2e.ts
 *
 * Every account id is minted fresh per run and every row this suite writes is
 * deleted at the end, so it is re-runnable back to back with no manual cleanup.
 *
 * Exits non-zero if any check fails, so it is CI-usable as-is.
 *
 * What it proves, by section:
 *   1–2  M2 — PUT /payments/refunds/:id/approve is reachable at the documented
 *        path and enforces auth → role → permission in that order. The doubled
 *        `/payments/payments/...` path the guard used to sit on is gone.
 *   3    Every write route rejects a malformed body with 400 VALIDATION_ERROR.
 *   4    The read/write/refund permission split is real, not decorative.
 *   5    M5 — a refund against another account's order is byte-for-byte
 *        indistinguishable from one against an id that does not exist.
 *   6    A write made through the API is confirmed by querying Postgres.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3022';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const PAYMENT_DATABASE_URL = process.env.PAYMENT_DATABASE_URL;
if (!JWT_SECRET || !PAYMENT_DATABASE_URL) {
  console.error('JWT_ACCESS_SECRET / PAYMENT_DATABASE_URL missing — did you `source .env`?');
  process.exit(1);
}

// ── Identities ───────────────────────────────────────────────────────────────
// Fresh per run: the suite owns every row it touches and leaves nothing behind
// for the next run to trip over.

const ACCOUNT = crypto.randomUUID();
const OTHER_ACCOUNT = crypto.randomUUID();
const ADMIN_ACCOUNT = crypto.randomUUID();
/** An id that is a well-formed UUID and belongs to nothing. */
const GHOST_ID = crypto.randomUUID();

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
      sub: ACCOUNT,
      email: 'payments.e2e@longeny.com',
      role: 'user',
      roles: ['user'],
      permissions: ['payments:read', 'payments:write'],
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

/** The ordinary paying customer: both payment permissions, no admin role. */
const userHeaders = json(mintToken());
/** A second real account — used for the cross-tenant checks. */
const otherHeaders = json(mintToken({ sub: OTHER_ACCOUNT, email: 'other.e2e@longeny.com' }));
/** Can read payments, cannot write them. */
const readOnlyHeaders = json(mintToken({ permissions: ['payments:read'] }));
/** Admin role, but only the ordinary write permission — not `payments:refund`. */
const adminNoRefundHeaders = json(
  mintToken({
    sub: ADMIN_ACCOUNT,
    role: 'admin',
    roles: ['admin'],
    permissions: ['payments:read', 'payments:write'],
  }),
);
/** Admin role holding `payments:refund` — the only identity that may approve. */
const refundAdminHeaders = json(
  mintToken({
    sub: ADMIN_ACCOUNT,
    role: 'admin',
    roles: ['admin'],
    permissions: ['payments:read', 'payments:write', 'payments:refund'],
  }),
);
/** Same permission held by a super_admin — the second role the guard names. */
const superAdminHeaders = json(
  mintToken({
    sub: ADMIN_ACCOUNT,
    role: 'super_admin',
    roles: ['super_admin'],
    permissions: ['payments:refund'],
  }),
);
/** Payment permissions but no admin role — must be stopped by the role layer. */
const refundPermNoRoleHeaders = json(mintToken({ permissions: ['payments:refund'] }));

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

/** The `id` of every row in a `{ success, data: [...] }` collection response. */
function listIds(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  return body.data.filter(isRecord).map((row) => String(row.id));
}

/**
 * A 404 body echoes the id that was asked for, so two 404s for different ids
 * can never be literally equal. Substituting the queried id and the response
 * timestamp — the only two fields that are *allowed* to differ — leaves exactly
 * the bytes that must not differ. If the service ever distinguishes "someone
 * else's row" from "no such row", the two fingerprints diverge and the check
 * below fails.
 */
function fingerprint(raw: string, id: string): string {
  return raw
    .replaceAll(id, '<queried-id>')
    .replace(/"timestamp":"[^"]*"/, '"timestamp":"<timestamp>"');
}

// ── Preflight ────────────────────────────────────────────────────────────────

try {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (err) {
  console.error(`payment-service not reachable at ${BASE} — start it first.\n  ${err}`);
  process.exit(1);
}

const sql = postgres(PAYMENT_DATABASE_URL as string);

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Two real, paid orders — one per account — each with a succeeded payment, so
// the refund path reaches the ownership branch rather than bouncing off a
// status check. Seeded through SQL rather than the API because
// `POST /payments/orders` is currently unreachable; §6 asserts that as a
// defect rather than quietly working around it.

const seededOrders: string[] = [];

async function seedPaidOrder(userId: string, label: string): Promise<string> {
  const orderNumber = `E2E-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`.slice(
    0,
    20,
  );
  const [order] = await sql<{ id: string }[]>`
    INSERT INTO orders (order_number, user_id, provider_id, order_type, status,
                        subtotal, tax, platform_fee, discount, total, currency, notes)
    VALUES (${orderNumber}, ${userId}::uuid, ${crypto.randomUUID()}::uuid, 'session', 'paid',
            '100.00', '0', '10.00', '0', '100.00', 'USD', ${label})
    RETURNING id
  `;
  if (!order) throw new Error('fixture order insert returned no row');
  await sql`
    INSERT INTO payments (order_id, gateway_payment_id, amount, currency, status, paid_at)
    VALUES (${order.id}::uuid, ${`e2e_pi_${crypto.randomUUID()}`}, '100.00', 'USD', 'succeeded', NOW())
  `;
  seededOrders.push(order.id);
  return order.id;
}

const myOrderId = await seedPaidOrder(ACCOUNT, 'payments-rbac.e2e own order');
const otherOrderId = await seedPaidOrder(OTHER_ACCOUNT, 'payments-rbac.e2e foreign order');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Refund approval is reachable at the documented path (M2)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n1. PUT /payments/refunds/:id/approve is routed, and the old doubled path is not');

const approvePath = `/payments/refunds/${GHOST_ID}/approve`;
const doubledPath = `/payments/payments/refunds/${GHOST_ID}/approve`;

const reachable = await request('PUT', approvePath, refundAdminHeaders);
check(
  'the documented path is routed — a fully authorised call is not answered "Route not found"',
  errorField(reachable.body, 'message') !== 'Route not found',
  { status: reachable.status, body: reachable.body },
);

const doubled = await request('PUT', doubledPath, refundAdminHeaders);
check(
  'the doubled /payments/payments/... path the guard used to sit on is 404',
  doubled.status === 404 && errorField(doubled.body, 'message') === 'Route not found',
  { status: doubled.status, body: doubled.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. The three guard layers fire in order
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Approval enforces auth, then role, then permission');

const noToken = await request('PUT', approvePath, { 'Content-Type': 'application/json' });
check(
  'no token → 401 UNAUTHORIZED',
  noToken.status === 401 && errorField(noToken.body, 'code') === 'UNAUTHORIZED',
  { status: noToken.status, body: noToken.body },
);

const badToken = await request('PUT', approvePath, {
  Authorization: 'Bearer not.a.jwt',
  'Content-Type': 'application/json',
});
check(
  'an unverifiable token → 401 INVALID_TOKEN',
  badToken.status === 401 && errorField(badToken.body, 'code') === 'INVALID_TOKEN',
  { status: badToken.status, body: badToken.body },
);

const wrongRole = await request('PUT', approvePath, refundPermNoRoleHeaders);
check(
  'wrong role → 403 even when the token carries payments:refund',
  wrongRole.status === 403 && errorField(wrongRole.body, 'code') === 'FORBIDDEN',
  { status: wrongRole.status, body: wrongRole.body },
);
check(
  'the role denial names the roles that are accepted',
  errorField(wrongRole.body, 'message') === 'Requires one of roles: admin, super_admin',
  errorField(wrongRole.body, 'message'),
);

const missingPermission = await request('PUT', approvePath, adminNoRefundHeaders);
check(
  'admin without payments:refund → 403',
  missingPermission.status === 403 && errorField(missingPermission.body, 'code') === 'FORBIDDEN',
  { status: missingPermission.status, body: missingPermission.body },
);
check(
  'the permission denial names the permission that is missing',
  errorField(missingPermission.body, 'message') === 'Requires permission: payments:refund',
  errorField(missingPermission.body, 'message'),
);

check(
  'admin with payments:refund gets past both guards into the service (404 for an unknown refund)',
  reachable.status === 404 &&
    errorField(reachable.body, 'code') === 'NOT_FOUND' &&
    errorField(reachable.body, 'message') === `Refund with id '${GHOST_ID}' not found`,
  { status: reachable.status, body: reachable.body },
);

const superAdmin = await request('PUT', approvePath, superAdminHeaders);
check(
  'super_admin with payments:refund also gets past both guards',
  superAdmin.status === 404 && errorField(superAdmin.body, 'code') === 'NOT_FOUND',
  { status: superAdmin.status, body: superAdmin.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Every write route rejects a malformed body
// ─────────────────────────────────────────────────────────────────────────────
// Each case is sent with a token that holds the permission the route wants, so
// a 400 can only have come from body validation and not from a guard.

console.log('\n3. Write routes reject malformed bodies with 400 VALIDATION_ERROR');

const malformedWrites: Array<{ label: string; method: string; path: string; body: unknown }> = [
  { label: 'POST /payments/checkout', method: 'POST', path: '/payments/checkout', body: {} },
  {
    label: 'POST /payments/orders',
    method: 'POST',
    path: '/payments/orders',
    body: { orderType: 'donation', itemId: 'not-a-uuid' },
  },
  {
    label: 'POST /payments/orders/:id/pay',
    method: 'POST',
    path: `/payments/orders/${GHOST_ID}/pay`,
    body: { paymentGateway: 'cheque' },
  },
  {
    label: 'POST /payments/create-intent',
    method: 'POST',
    path: '/payments/create-intent',
    body: { amount: -500, currency: 'DOLLARS' },
  },
  {
    label: 'POST /payments/setup-intent',
    method: 'POST',
    path: '/payments/setup-intent',
    // The only field is `gateway`, which has a default — so the malformed case
    // is an unknown gateway, not a missing field.
    body: { gateway: 'cheque' },
  },
  {
    label: 'POST /payments/refunds',
    method: 'POST',
    path: '/payments/refunds',
    body: { orderId: 'not-a-uuid', reason: '' },
  },
  {
    label: 'POST /payments/subscriptions',
    method: 'POST',
    path: '/payments/subscriptions',
    body: { planId: 'not-a-uuid', interval: 'fortnightly' },
  },
  {
    label: 'PUT /payments/subscriptions/:id',
    method: 'PUT',
    path: `/payments/subscriptions/${GHOST_ID}`,
    body: { interval: 'fortnightly' },
  },
  {
    label: 'PATCH /payments/subscriptions/:id/cancel',
    method: 'PATCH',
    path: `/payments/subscriptions/${GHOST_ID}/cancel`,
    body: { cancelAtPeriodEnd: 'yes please' },
  },
];

for (const testCase of malformedWrites) {
  const result = await request(testCase.method, testCase.path, userHeaders, testCase.body);
  check(
    `${testCase.label} rejects a malformed body with 400 VALIDATION_ERROR`,
    result.status === 400 && errorField(result.body, 'code') === 'VALIDATION_ERROR',
    { status: result.status, body: result.body },
  );
}

const emptyRefundBody = await request('POST', '/payments/refunds', userHeaders, {});
check(
  'POST /payments/refunds with an empty body is rejected, not defaulted',
  emptyRefundBody.status === 400 && errorField(emptyRefundBody.body, 'code') === 'VALIDATION_ERROR',
  { status: emptyRefundBody.status, body: emptyRefundBody.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. The permission split is real
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. payments:read, payments:write and payments:refund are not interchangeable');

const readerListing = await request('GET', '/payments/orders', readOnlyHeaders);
check(
  'a payments:read token can list orders — it is a valid token, not a broken one',
  readerListing.status === 200,
  { status: readerListing.status, body: readerListing.body },
);

// Elysia validates the body before beforeHandle, so this body must be *valid*:
// a malformed one would be refused at 400 by the schema and never reach the
// permission guard, and the check would pass for the wrong reason.
const readerWrite = await request('POST', '/payments/orders', readOnlyHeaders, {
  providerId: crypto.randomUUID(),
  orderType: 'session',
  currency: 'USD',
  items: [
    {
      entityType: 'session',
      entityId: crypto.randomUUID(),
      description: 'Permission probe',
      quantity: 1,
      unitPrice: 10,
    },
  ],
});
check(
  'payments:read alone cannot POST an order → 403 naming payments:write',
  readerWrite.status === 403 &&
    errorField(readerWrite.body, 'message') === 'Requires permission: payments:write',
  { status: readerWrite.status, body: readerWrite.body },
);

const readerRefundRequest = await request('POST', '/payments/refunds', readOnlyHeaders, {
  orderId: myOrderId,
  reason: 'payments:read must not be able to move money',
});
check(
  'payments:read alone cannot request a refund → 403 naming payments:write',
  readerRefundRequest.status === 403 &&
    errorField(readerRefundRequest.body, 'message') === 'Requires permission: payments:write',
  { status: readerRefundRequest.status, body: readerRefundRequest.body },
);

check(
  'payments:write alone cannot approve a refund → 403 naming payments:refund',
  missingPermission.status === 403 &&
    errorField(missingPermission.body, 'message') === 'Requires permission: payments:refund',
  { status: missingPermission.status, body: missingPermission.body },
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ownership answers 404, not 403 (M5)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n5. A refund against another account's order is indistinguishable from a ghost id");

const foreignRefund = await request('POST', '/payments/refunds', userHeaders, {
  orderId: otherOrderId,
  reason: 'attempting a refund against an order this account does not own',
});
const ghostRefund = await request('POST', '/payments/refunds', userHeaders, {
  orderId: GHOST_ID,
  reason: 'attempting a refund against an order that does not exist',
});

check(
  "another account's real order → 404, not 403",
  foreignRefund.status === 404 && errorField(foreignRefund.body, 'code') === 'NOT_FOUND',
  { status: foreignRefund.status, body: foreignRefund.body },
);
check(
  'an order id that does not exist → 404',
  ghostRefund.status === 404 && errorField(ghostRefund.body, 'code') === 'NOT_FOUND',
  { status: ghostRefund.status, body: ghostRefund.body },
);
check('both answers carry the same status code', foreignRefund.status === ghostRefund.status, {
  foreign: foreignRefund.status,
  ghost: ghostRefund.status,
});
check(
  'the two response bodies are equal once the echoed id is normalised — no existence oracle',
  fingerprint(foreignRefund.raw, otherOrderId) === fingerprint(ghostRefund.raw, GHOST_ID),
  {
    foreign: fingerprint(foreignRefund.raw, otherOrderId),
    ghost: fingerprint(ghostRefund.raw, GHOST_ID),
  },
);

const [foreignRefundRows] = await sql<{ count: number }[]>`
  SELECT COUNT(*)::int AS count FROM refunds WHERE order_id = ${otherOrderId}::uuid
`;
check(
  "the rejected cross-account request wrote no refund row against the other account's order",
  foreignRefundRows?.count === 0,
  foreignRefundRows,
);

const foreignOrderRead = await request('GET', `/payments/orders/${otherOrderId}`, userHeaders);
const ghostOrderRead = await request('GET', `/payments/orders/${GHOST_ID}`, userHeaders);
check(
  "GET /payments/orders/:id on another account's order is also 404",
  foreignOrderRead.status === 404,
  { status: foreignOrderRead.status, body: foreignOrderRead.body },
);
check(
  'and its body matches the ghost-id body once the echoed id is normalised',
  fingerprint(foreignOrderRead.raw, otherOrderId) === fingerprint(ghostOrderRead.raw, GHOST_ID),
  {
    foreign: fingerprint(foreignOrderRead.raw, otherOrderId),
    ghost: fingerprint(ghostOrderRead.raw, GHOST_ID),
  },
);

const otherAccountListing = await request('GET', '/payments/orders', otherHeaders);
const otherIds = listIds(otherAccountListing.body);
check(
  "the other account's own listing contains its order and not this account's",
  otherIds.includes(otherOrderId) && !otherIds.includes(myOrderId),
  { otherIds },
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. A write made through the API, confirmed in Postgres
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n6. Writes are verified against longeny_payments, not against the HTTP response');

const orderItemId = crypto.randomUUID();
const createdOrder = await request('POST', '/payments/orders', userHeaders, {
  // Satisfies both the route schema in @longeny/validators (orderType, itemId,
  // quantity, currency) and the controller's own schema (providerId, items).
  orderType: 'session',
  itemId: orderItemId,
  quantity: 1,
  currency: 'USD',
  providerId: crypto.randomUUID(),
  items: [
    {
      entityType: 'session',
      entityId: orderItemId,
      description: 'payments-rbac.e2e order',
      quantity: 1,
      unitPrice: 100,
    },
  ],
});
check(
  'POST /payments/orders creates an order for the calling account',
  createdOrder.status === 201,
  { status: createdOrder.status, body: createdOrder.body },
);

const apiOrderId = String(dataRecord(createdOrder.body).id ?? '');
const apiOrderRows = apiOrderId
  ? await sql<{ id: string; user_id: string; status: string; total: string }[]>`
      SELECT id, user_id, status, total FROM orders WHERE id = ${apiOrderId}::uuid
    `
  : [];
if (apiOrderId) seededOrders.push(apiOrderId);
check(
  'the order the API returned exists as a row in longeny_payments, owned by the caller',
  apiOrderRows.length === 1 && apiOrderRows[0]?.user_id === ACCOUNT,
  { apiOrderId, apiOrderRows },
);

// The refund request path *is* reachable, so it carries the database-first
// verification of an API write end to end.
const refundReason = `payments-rbac.e2e refund ${crypto.randomUUID()}`;
const createdRefund = await request('POST', '/payments/refunds', userHeaders, {
  orderId: myOrderId,
  reason: refundReason,
  amount: 25,
});
check(
  'POST /payments/refunds on this account’s own paid order returns 201',
  createdRefund.status === 201,
  { status: createdRefund.status, body: createdRefund.body },
);

const refundId = String(dataRecord(createdRefund.body).id ?? '');
const refundRows = await sql<
  { id: string; order_id: string; status: string; amount: string; owner: string }[]
>`
  SELECT r.id, r.order_id, r.status, r.amount, o.user_id AS owner
  FROM refunds r JOIN orders o ON o.id = r.order_id
  WHERE r.reason = ${refundReason}
`;
check(
  'the refund the API reported is a real row in longeny_payments',
  refundRows.length === 1 && refundRows[0]?.id === refundId,
  { refundId, refundRows },
);
check(
  'the stored refund is attached to the calling account’s order, at the requested amount',
  refundRows[0]?.owner === ACCOUNT &&
    refundRows[0]?.order_id === myOrderId &&
    Number(refundRows[0]?.amount) === 25 &&
    refundRows[0]?.status === 'pending',
  refundRows[0],
);

const refundListing = await request('GET', '/payments/refunds', userHeaders);
const listedRefundIds = listIds(refundListing.body);
check(
  'the refund appears in the calling account’s own listing',
  listedRefundIds.includes(refundId),
  { refundId, listedRefundIds },
);

const otherRefundListing = await request('GET', '/payments/refunds', otherHeaders);
const otherListedRefundIds = listIds(otherRefundListing.body);
check('and not in the other account’s listing', !otherListedRefundIds.includes(refundId), {
  refundId,
  otherListedRefundIds,
});

// ─────────────────────────────────────────────────────────────────────────────
// Teardown — every row this run created, in foreign-key order.
// ─────────────────────────────────────────────────────────────────────────────

if (seededOrders.length > 0) {
  await sql`DELETE FROM refunds WHERE order_id = ANY(${seededOrders}::uuid[])`;
  await sql`DELETE FROM payments WHERE order_id = ANY(${seededOrders}::uuid[])`;
  await sql`DELETE FROM order_items WHERE order_id = ANY(${seededOrders}::uuid[])`;
  await sql`DELETE FROM orders WHERE id = ANY(${seededOrders}::uuid[])`;
}
await sql`DELETE FROM gateway_customers WHERE user_id = ANY(${[ACCOUNT, OTHER_ACCOUNT]}::uuid[])`;
await sql.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
