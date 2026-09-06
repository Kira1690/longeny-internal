/**
 * End-to-end tests for profile-scoped bookings, provider access, and calendar
 * invites to people with no login (Week 7, cards W7-8 and W7-9).
 *
 * Real services, real PostgreSQL, real Redis, real SMTP — no mocks. Requires:
 *   1. user-provider-service on :3002, booking-service on :3003
 *   2. A mail server on SMTP_PORT with an HTTP API on MAILPIT_URL
 *      (docker run -d --name w7mail -p 1026:1025 -p 8026:8025 axllent/mailpit)
 *
 * Run:
 *   set -a; source .env; set +a
 *   bun run apps/booking-service/test/booking-profile.e2e.ts
 *
 * The invite checks read the delivered message out of the mail server. A test
 * that only asserted the endpoint returned 200 would have passed for the whole
 * of Week 6, when nothing was ever sent.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3003';
const USER_PROVIDER = process.env.USER_PROVIDER_SERVICE_URL ?? 'http://localhost:3002';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8026';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
if (!JWT_SECRET || !HMAC_SECRET) {
  console.error('JWT_ACCESS_SECRET / HMAC_SECRET missing — did you `source .env`?');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AUTH_ID = crypto.randomUUID();
const PROVIDER_ID = crypto.randomUUID();

const USER_PERMISSIONS = [
  'profiles:read',
  'profiles:write',
  'bookings:read',
  'bookings:write',
  'bookings:cancel',
  'documents:read',
];

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      sub: AUTH_ID,
      email: `w7bk-${RUN}@longeny.test`,
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
const noPermissionHeaders = {
  Authorization: `Bearer ${mintToken({ permissions: ['users:read'] })}`,
  'Content-Type': 'application/json',
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function hmacHeaders(method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', HMAC_SECRET as string)
    .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256(body)}`)
    .digest('hex');
  return {
    'X-Service-Name': 'ai-content-service',
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
  ['booking', `${BASE}/health`],
  ['user-provider', `${USER_PROVIDER}/health`],
  ['mail server', `${MAILPIT}/api/v1/info`],
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
const bookingDb = postgres(process.env.BOOKING_DATABASE_URL as string);

await core`
  INSERT INTO users (auth_id, email, first_name, last_name)
  VALUES (${AUTH_ID}::uuid, ${`w7bk-${RUN}@longeny.test`}, 'Booker', 'Test')
  ON CONFLICT (auth_id) DO NOTHING
`;

// ── Fixtures ─────────────────────────────────────────────────────────────────

let r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'father', firstName: `Dad-${RUN}` }),
  }),
);
const dadId: string = r.body.data?.id;
check('father profile created', r.status === 201 && Boolean(dadId), r);

r = await call(await fetch(`${USER_PROVIDER}/profiles`, { headers: authHeaders }));
const selfId: string = r.body.data?.find((p: any) => p.is_self)?.id;
check('the account has its own self profile', Boolean(selfId));

// ── 1. A booking is for a subject of care (W7-8) ─────────────────────────────

console.log('\n1. A booking made for a parent belongs to the parent, not the account owner');

const start = new Date(Date.now() + 86_400_000);
const end = new Date(start.getTime() + 3_600_000);

r = await call(
  await fetch(`${BASE}/bookings`, {
    method: 'POST',
    headers: { ...authHeaders, 'X-Active-Profile-Id': dadId },
    body: JSON.stringify({
      providerId: PROVIDER_ID,
      sessionType: 'consultation',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: 'Asia/Kolkata',
      notes: `run-${RUN}`,
    }),
  }),
);
check('201 Created', r.status === 201, r);
const bookingId: string = r.body.data?.id;

const rows = await bookingDb`
  SELECT user_id, profile_id, status FROM bookings WHERE id = ${bookingId}::uuid
`;
check('the database row names the father profile', rows[0]?.profile_id === dadId, rows[0]);
check(
  'while the account remains the one that booked and pays',
  rows[0]?.user_id === AUTH_ID,
  rows[0],
);

r = await call(await fetch(`${BASE}/bookings?profileId=${dadId}`, { headers: authHeaders }));
check(
  'the father’s list contains it',
  (r.body.data ?? []).some((b: any) => b.id === bookingId),
  r.body.data,
);

r = await call(await fetch(`${BASE}/bookings?profileId=${selfId}`, { headers: authHeaders }));
check(
  'the account owner’s own list does not',
  !(r.body.data ?? []).some((b: any) => b.id === bookingId),
  r.body.data,
);

r = await call(await fetch(`${BASE}/bookings`, { headers: authHeaders }));
check(
  'unfiltered, the account still sees everything it booked',
  (r.body.data ?? []).some((b: any) => b.id === bookingId),
  r.body.data,
);

const strangerProfile = crypto.randomUUID();
r = await call(
  await fetch(`${BASE}/bookings?profileId=${strangerProfile}`, { headers: authHeaders }),
);
check(
  'a profile id from outside the account narrows to nothing',
  (r.body.data ?? []).length === 0,
  r.body.data,
);

// ── 2. Provider access is derived from a booking (W7-7 / D-4) ────────────────

console.log('\n2. Provider access to a profile comes from an active booking, and only from that');

const accessPath = `/internal/bookings/access?providerId=${PROVIDER_ID}&profileId=${dadId}`;
r = await call(
  await fetch(`${BASE}${accessPath}`, { headers: hmacHeaders('GET', accessPath, '') }),
);
check('the booked provider has access', r.body.data?.hasAccess === true, r.body);
check(
  'and the basis names the booking that justifies it',
  String(r.body.data?.basis ?? '').startsWith('booking:'),
  r.body.data,
);

const strangerPath = `/internal/bookings/access?providerId=${crypto.randomUUID()}&profileId=${dadId}`;
r = await call(
  await fetch(`${BASE}${strangerPath}`, { headers: hmacHeaders('GET', strangerPath, '') }),
);
check('a provider with no booking does not', r.body.data?.hasAccess === false, r.body.data);
check('and gets no basis', r.body.data?.basis === null, r.body.data);

r = await call(await fetch(`${BASE}${accessPath}`));
check('the access check is not reachable unsigned', r.status === 401, r);

await bookingDb`UPDATE bookings SET status = 'cancelled' WHERE id = ${bookingId}::uuid`;
r = await call(
  await fetch(`${BASE}${accessPath}`, { headers: hmacHeaders('GET', accessPath, '') }),
);
check('cancelling the booking withdraws the access', r.body.data?.hasAccess === false, r.body.data);

await bookingDb`UPDATE bookings SET status = 'completed' WHERE id = ${bookingId}::uuid`;
r = await call(
  await fetch(`${BASE}${accessPath}`, { headers: hmacHeaders('GET', accessPath, '') }),
);
check(
  'a completed session keeps it — the clinician still needs the notes',
  r.body.data?.hasAccess === true,
  r.body.data,
);

// ── 3. Calendar invite to someone with no login (W7-9) ───────────────────────

console.log('\n3. A calendar invite reaches a dependent who has no login');

const dadEmail = `dad-${RUN}@family.test`;
r = await call(
  await fetch(`${USER_PROVIDER}/profiles/${dadId}/notification-targets`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ channel: 'calendar', destination: dadEmail }),
  }),
);
check('a calendar target is registered for the profile', r.status === 201, r);
check('and the address is never echoed back', !JSON.stringify(r.body).includes(dadEmail), r.body);

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      profileId: dadId,
      title: `Consultation ${RUN}`,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      description: 'Bring recent labs',
      location: 'Clinic, Pune',
    }),
  }),
);
check('200 OK', r.status === 200, r);
check('one target was reached', r.body.data?.delivered === 1, r.body.data);

const inbox = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as any;
const message = inbox.messages?.find((m: any) => m.To?.some((t: any) => t.Address === dadEmail));
check('the mail server actually holds the message', Boolean(message), inbox.messages?.length);
check('addressed to the dependent, not the account owner', Boolean(message), message?.To);
check(
  'with the appointment as the subject',
  message?.Subject === `Consultation ${RUN}`,
  message?.Subject,
);
check('and an attachment', (message?.Attachments ?? 0) > 0, message);

const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message?.ID}`)).json()) as any;
const ics = full?.Attachments?.[0];
check(
  'the attachment is a calendar invite',
  String(ics?.ContentType ?? '').includes('text/calendar'),
  ics,
);

const icsBody = await (
  await fetch(`${MAILPIT}/api/v1/message/${message?.ID}/part/${ics?.PartID}`)
).text();
check(
  'it is a well-formed VCALENDAR',
  icsBody.includes('BEGIN:VCALENDAR') && icsBody.includes('END:VCALENDAR'),
  icsBody.slice(0, 80),
);
check('carrying one event', icsBody.includes('BEGIN:VEVENT'), icsBody.slice(0, 120));
check(
  'with a stable UID, so re-sending updates rather than duplicates',
  icsBody.includes(`UID:${dadId}-`),
  icsBody.slice(0, 300),
);
check(
  'the summary the recipient will see',
  icsBody.includes(`SUMMARY:Consultation ${RUN}`),
  icsBody.slice(0, 400),
);
check('and CRLF line endings, which strict clients require', icsBody.includes('\r\n'));

const logRows = await core`
  SELECT channel, status, error, sent_at FROM notification_log
  WHERE profile_id = ${dadId}::uuid ORDER BY created_at DESC
`;
check(
  'the delivery is recorded in the profile’s notification log',
  logRows.length > 0,
  logRows.length,
);
check('as sent, not merely queued', logRows[0]?.status === 'sent', logRows[0]);
check('with the time it went out', Boolean(logRows[0]?.sent_at), logRows[0]);

// ── 4. Failure is recorded, not swallowed ────────────────────────────────────

console.log('\n4. An invite that cannot be delivered says so');

r = await call(
  await fetch(`${USER_PROVIDER}/profiles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ relation: 'mother', firstName: `Mum-${RUN}` }),
  }),
);
const mumId: string = r.body.data?.id;

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      profileId: mumId,
      title: 'Nowhere to send this',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }),
  }),
);
check('a profile with no target → 502, not a cheerful 200', r.status === 502, r);
check('and the response says why', r.body.error?.code === 'DELIVERY_FAILED', r.body.error);

const failedRows = await core`
  SELECT status, error FROM notification_log WHERE profile_id = ${mumId}::uuid
`;
check('the failed attempt is still recorded', failedRows.length === 1, failedRows);
check(
  'as failed, with the reason',
  failedRows[0]?.status === 'failed' && Boolean(failedRows[0]?.error),
  failedRows[0],
);

console.log('\n5. SMS is honest about having no transport');

await fetch(`${USER_PROVIDER}/profiles/${mumId}/notification-targets`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ channel: 'sms', destination: '+919876500000' }),
});

const notifyBody = JSON.stringify({
  profileId: mumId,
  channel: 'sms',
  subject: 'Check-in',
  body: 'Time for your weekly check-in',
});
r = await call(
  await fetch(`${USER_PROVIDER}/internal/notify/profile`, {
    method: 'POST',
    headers: hmacHeaders('POST', '/internal/notify/profile', notifyBody),
    body: notifyBody,
  }),
);
check('the attempt is reported', r.status === 200, r);
check('nothing was delivered', r.body.data?.delivered === 0, r.body.data);
check(
  'and the row is failed rather than a queued promise nothing keeps',
  r.body.data?.entries?.[0]?.status === 'failed',
  r.body.data?.entries,
);
check(
  'naming the missing transport',
  String(r.body.data?.entries?.[0]?.error ?? '').includes('SMS'),
  r.body.data?.entries,
);

// ── 6. Access control on the invite route ────────────────────────────────────

console.log('\n6. Who may send an invite');

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: dadId,
      title: 'x',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }),
  }),
);
check('no token → 401', r.status === 401, r);

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: noPermissionHeaders,
    body: JSON.stringify({
      profileId: dadId,
      title: 'x',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }),
  }),
);
check('missing bookings:write → 403', r.status === 403, r);

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      profileId: dadId,
      title: 'Backwards',
      startTime: end.toISOString(),
      endTime: start.toISOString(),
    }),
  }),
);
check('an end before the start → 400', r.status === 400, r);
check('naming the field', r.body.error?.details?.fields?.[0]?.field === 'endTime', r.body.error);

r = await call(
  await fetch(`${BASE}/bookings/calendar/invite`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      profileId: crypto.randomUUID(),
      title: 'Nobody',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }),
  }),
);
check('a profile that does not exist → 404', r.status === 404, r);

// ── Teardown ─────────────────────────────────────────────────────────────────

for (const id of [dadId, mumId]) {
  if (id)
    await fetch(`${USER_PROVIDER}/profiles/${id}`, { method: 'DELETE', headers: authHeaders });
}
await bookingDb`DELETE FROM bookings WHERE user_id = ${AUTH_ID}::uuid`;
await core.end();
await bookingDb.end();

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
