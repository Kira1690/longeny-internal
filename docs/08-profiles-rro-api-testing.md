# Multi-Profile / Family (RRO) — API Testing Guide

A hands-on, copy-paste guide for a frontend developer to run and verify **every**
Profiles / RRO endpoint locally against the real `user-provider-service`. No mocks —
everything below runs against a real Elysia service, real PostgreSQL, and real Redis.

Pair this with the reference doc [07-profiles-rro-api.md](./07-profiles-rro-api.md)
(field tables, semantics). This document is about **running the tests**.

> Workflow note: all testing happens **locally in this repo**. Production deploy is a
> separate, selective step; this guide targets `http://localhost:3002`.

---

## 0. Prerequisites

- [Bun](https://bun.sh) ≥ 1.2, Docker, `psql` client, `curl`, `jq` (optional, for pretty output).
- Repo installed: from repo root `bun install`.
- The service is `apps/user-provider-service`, port **3002** (`USER_PROVIDER_SERVICE_PORT`).

---

## 1. Bring up infrastructure

The service needs PostgreSQL (`longeny_core`) and Redis. Ports come from `.env`
(`POSTGRES_PORT=5434`, `REDIS_PORT=6380`).

```bash
# From repo root
docker run -d --name longeny-pg \
  -e POSTGRES_USER=longeny -e POSTGRES_PASSWORD=longeny_dev_password \
  -e POSTGRES_DB=longeny_auth -p 5434:5432 pgvector/pgvector:pg16
docker run -d --name longeny-redis -p 6380:6379 redis:7-alpine

# Create the core DB + extension
PGPASSWORD=longeny_dev_password psql -h localhost -p 5434 -U longeny -d longeny_auth \
  -c "CREATE DATABASE longeny_core;"
PGPASSWORD=longeny_dev_password psql -h localhost -p 5434 -U longeny -d longeny_core \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
```

*(If you already run the project's `docker-compose`, skip this and just make sure
`longeny_core` exists and `.env` points at the right ports.)*

## 2. Push the schema

```bash
cd apps/user-provider-service
set -a; source ../../.env; set +a
bunx drizzle-kit push --force        # creates profiles, rro_state, caregiver_consent, …
```

Verify:

```bash
PGPASSWORD=longeny_dev_password psql -h localhost -p 5434 -U longeny -d longeny_core -c '\dt' \
  | grep -E 'profiles|rro_|caregiver|notification_'
```

## 3. Seed a test account

The account must exist in the `users` table (in production the `user.registered` event
creates it; for isolated testing insert it directly).

```bash
PGPASSWORD=longeny_dev_password psql -h localhost -p 5434 -U longeny -d longeny_core <<'SQL'
INSERT INTO users (id, auth_id, email, first_name, last_name)
VALUES ('11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        'vishal.test@longeny.com', 'Vishal', 'Dafada')
ON CONFLICT (id) DO NOTHING;
SQL
```

## 4. Boot the service

```bash
cd apps/user-provider-service
set -a; source ../../.env; set +a
bun run src/index.ts
# → "User & Provider Service started on port 3002"
curl -s http://localhost:3002/health        # {"status":"healthy",...}
```

Swagger UI (interactive): **http://localhost:3002/docs** → tag **Profiles**.

### Testing straight from Swagger UI

Everything in this guide can also be driven from the browser — usually the fastest way
for a frontend developer to explore:

1. Open **http://localhost:3002/docs**.
2. Click **Authorize** (top right) and paste your access token from §5 — just the raw
   JWT, the `Bearer ` prefix is added for you. All `Profiles` endpoints are now callable.
3. Pick an endpoint → **Try it out** → edit the pre-filled example body → **Execute**.

Each endpoint documents its full request body (field types, enums, min/max, which are
required), every response code it can return, and a realistic example payload. The
**Internal** tag documents the HMAC endpoints and their required headers; those can't be
executed from the browser (they need a signature — use §7 instead), but the contract is
there for backend/AI engineers.

The OpenAPI JSON itself is at **http://localhost:3002/docs/json** — feed it to Postman,
Insomnia, or a client generator:

```bash
curl -s http://localhost:3002/docs/json -o openapi.json   # import into Postman/Insomnia
```

---

## 5. Get a Bearer token

Every `/profiles/*` route needs `Authorization: Bearer <token>`. Two ways:

### Option A — full stack (realistic)
Run `auth-service` too, `POST /auth/register` then `POST /auth/login`, and use the
returned access token. The `user.registered` event creates the matching `users` row
automatically. See [01-auth-api-reference.md](./01-auth-api-reference.md).

### Option B — isolated (mint a token, matches step 3's seed)
The token is a normal HS256 JWT signed with `JWT_ACCESS_SECRET` — identical in shape to
what `auth-service` issues, so `requireAuth` accepts it. Use the committed helper
`apps/user-provider-service/scripts/token.ts`:

```bash
cd apps/user-provider-service
set -a; source ../../.env; set +a
export TOKEN=$(bun run scripts/token.ts)          # seeded test account, 15-min expiry
export BASE=http://localhost:3002

# or any other account:
# bun run scripts/token.ts <authId> <email>
```

Tokens expire in 15 minutes — re-run the command if you start getting `401
TOKEN_EXPIRED`.

**A token now needs permissions, not just a role.** Every profile and progress route is
permission-guarded, so a token carrying only `role: "user"` gets `403 FORBIDDEN` naming the
permission it lacks. A hand-minted token must carry:

```json
{
  "sub": "<authId>", "email": "…",
  "role": "user",
  "roles": ["user"],
  "permissions": [
    "profiles:read", "profiles:write", "consent:grant", "rro:read",
    "progress:read", "progress:write"
  ],
  "jti": "<uuid>"
}
```

Tokens from `auth-service` carry these automatically — they come from `role_permissions`.
See [09-auth-permissions-and-profile-context.md](./09-auth-permissions-and-profile-context.md).

---

## 6. Testing each endpoint (curl)

All authed calls use `-H "Authorization: Bearer $TOKEN"`. Responses are wrapped as
`{ "success": true, "data": … }`.

### 6.1 List profiles — auto-creates `self`
```bash
curl -s $BASE/profiles -H "Authorization: Bearer $TOKEN" | jq
```
First call returns exactly one profile, the account's `self`:
```json
{ "success": true, "data": [
  { "id": "…", "relation": "self", "is_self": true, "first_name": "Vishal",
    "status": "active", "has_phone": false, "has_date_of_birth": false }
] }
```

### 6.2 Create a dependent (parent) profile
```bash
curl -s -X POST $BASE/profiles -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "relation":"father","firstName":"Ramesh","lastName":"Dafada",
    "email":"ramesh@example.com","phone":"+919876543210",
    "dateOfBirth":"1958-04-12","gender":"male","goal":"Reverse type-2 diabetes"
  }' | jq
```
`201`. Note: **no `phone`/`phone_hash` in the response** — only `has_phone: true`.
A fresh `rroState` in `intake` is returned:
```json
{ "success": true, "data": {
  "id": "66de1c77-…", "relation": "father", "is_self": false,
  "first_name": "Ramesh", "last_name": "Dafada", "email": "ramesh@example.com",
  "gender": "male", "status": "active",
  "has_phone": true, "has_date_of_birth": true,
  "rroState": { "current_state": "intake", "goal": "Reverse type-2 diabetes" } } }
```
Grab the id for the next calls:
```bash
export PID=$(curl -s -X POST $BASE/profiles -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"relation":"father","firstName":"Ramesh","goal":"Reverse type-2 diabetes"}' \
  | jq -r '.data.id')
```

### 6.3 Get one profile
```bash
curl -s $BASE/profiles/$PID -H "Authorization: Bearer $TOKEN" | jq
```

### 6.4 Update a profile
```bash
curl -s -X PATCH $BASE/profiles/$PID -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"notes":"Prefers morning calls"}' | jq
```

### 6.5 Activate (switch active profile) — ownership guard
```bash
curl -s -X POST $BASE/profiles/$PID/activate -H "Authorization: Bearer $TOKEN" | jq
```
```json
{ "success": true, "data": {
  "accountUserId": "11111111-…", "activeProfileId": "df864dbd-…",
  "profile": { … }, "rroState": { "current_state": "intake", … } } }
```
After this, the frontend sends `X-Active-Profile-Id: $PID` on scoped requests.

### 6.6 Caregiver consent — grant / read / revoke
```bash
# grant (201)
curl -s -X POST $BASE/profiles/$PID/consent -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"consentType":"health_data","status":"granted","notes":"Signed form"}' | jq

# read
curl -s $BASE/profiles/$PID/consent -H "Authorization: Bearer $TOKEN" | jq

# revoke (re-post same type → upserts, does NOT duplicate; sets revoked_at)
curl -s -X POST $BASE/profiles/$PID/consent -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"consentType":"health_data","status":"revoked"}' | jq
```
Grant response:
```json
{ "success": true, "data": {
  "id": "8ec5ef94-…", "profile_id": "df864dbd-…", "consent_type": "health_data",
  "status": "granted", "granted_by": "11111111-…", "granted_at": "…",
  "revoked_at": null } }
```

### 6.7 Add a parent notification target
```bash
curl -s -X POST $BASE/profiles/$PID/notification-targets -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"sms","destination":"+919876543210"}' | jq
```
```json
{ "success": true, "data": {
  "id": "75a5478c-…", "profile_id": "df864dbd-…", "channel": "sms",
  "is_active": true, "created_at": "…" } }
```
*(`destination` is encrypted at rest and not returned.)*

### 6.8 RRO state + history
```bash
curl -s $BASE/profiles/$PID/rro-state -H "Authorization: Bearer $TOKEN" | jq
```
```json
{ "success": true, "data": {
  "current_state": "reverse", "goal": "Reverse type-2 diabetes",
  "history": [
    { "from_state": "intake", "to_state": "reverse", "source": "ai_classifier" },
    { "from_state": null, "to_state": "intake", "source": "system" }
  ] } }
```

### 6.9 Notification history
```bash
curl -s $BASE/profiles/$PID/notifications -H "Authorization: Bearer $TOKEN" | jq
```

### 6.10 Deactivate a profile
```bash
curl -s -X DELETE $BASE/profiles/$PID -H "Authorization: Bearer $TOKEN" | jq
# { "success": true, "data": { "id": "…", "status": "inactive" } }
```

---

## 7. Internal (service-to-service) endpoints — HMAC

These are called by **other backend services** (the AI RRO classifier, notification
producers), never from the browser. They require the HMAC headers, not a JWT.

Signature: `HMAC-SHA256(secret, "METHOD\nPATH\nTIMESTAMP\nSHA256(body)")` over the
**exact raw JSON string** sent. The timestamp must be within **30 seconds** of server
time (replay protection), and the signed body must be byte-identical to what you send —
a single differing character fails verification.

`apps/user-provider-service/scripts/sign.ts` prints ready-made header flags:

```bash
cd apps/user-provider-service
set -a; source ../../.env; set +a
bun run scripts/sign.ts POST /internal/notify/profile '{"profileId":"…","body":"hi"}'
# -H "X-Service-Name: ai-content-service" -H "X-Timestamp: …" -H "X-Signature: …"
```

Because shell quoting mangles JSON bodies easily, drive these two endpoints with the
snippet below rather than pasting headers by hand. Save it as `scripts/internal-call.sh`
or paste inline:

```bash
# usage: internal_call <PATH> <JSON_BODY>
internal_call() {
  local path="$1" body="$2"
  local ts sig
  ts=$(date +%s%3N)
  sig=$(bun -e '
    const c = require("node:crypto");
    const [body, ts, path] = process.argv.slice(1);
    const sha = c.createHash("sha256").update(body).digest("hex");
    console.log(c.createHmac("sha256", process.env.HMAC_SECRET)
      .update(`POST\n${path}\n${ts}\n${sha}`).digest("hex"));
  ' "$body" "$ts" "$path")
  curl -s -X POST "$BASE$path" \
    -H "X-Service-Name: ai-content-service" \
    -H "X-Timestamp: $ts" -H "X-Signature: $sig" \
    -H 'Content-Type: application/json' -d "$body" | jq
}
```

### 7.1 Record an RRO transition
```bash
internal_call /internal/rro-state/transition \
  "{\"profileId\":\"$PID\",\"toState\":\"reverse\",\"reason\":\"metabolic dysfunction\",\"source\":\"ai_classifier\"}"
```
```json
{ "success": true, "data": {
  "profileId": "df864dbd-…", "fromState": "intake", "toState": "reverse",
  "transitionId": "301a33f8-…" } }
```

### 7.2 Notify a parent profile
```bash
internal_call /internal/notify/profile \
  "{\"profileId\":\"$PID\",\"channel\":\"sms\",\"subject\":\"Check-in\",\"body\":\"Time for your weekly check-in\"}"
```
```json
{ "success": true, "data": {
  "profileId": "df864dbd-…", "delivered": 0, "attempted": 1,
  "entries": [ { "channel": "sms", "status": "failed", "subject": "Check-in",
                 "sent_at": null, "error": "No SMS transport is configured" } ] } }
```
> This endpoint **delivers**, it does not merely record intent. `email` and `calendar`
> go out over SMTP and the log row becomes `sent` (with `sent_at`) or `failed` (with the
> reason). `sms` has no transport yet, so it records `failed` saying exactly that —
> a `queued` row would promise a delivery nothing was going to make.
>
> `delivered` counts what actually went out; `attempted` counts the targets tried. A
> profile with no active target for the channel gets `delivered: 0` and one logged
> `failed` entry.
>
> To watch a real delivery locally, run a mail catcher and read it back:
> `docker run -d --name w7mail -p 1026:1025 -p 8026:8025 axllent/mailpit:latest`,
> then open http://localhost:8026.

> **Lifecycle note:** Elysia validates the body schema *before* the HMAC hook runs, so a
> **malformed** body returns `400` even without valid HMAC headers, while a
> **well-formed** body with bad/missing headers correctly returns `401`. No data is
> returned and no side effects occur in either case — but don't read a `400` as "my
> signature worked".

---

## 8. Negative / security tests (must fail as shown)

| # | Request | Expected |
|---|---------|----------|
| N1 | `GET /profiles` with no `Authorization` header | `401` UNAUTHORIZED |
| N2 | `GET /profiles/<random-uuid>` (a profile you don't own) | `404` (or `403` if it exists under another account) |
| N3 | `DELETE /profiles/<self-id>` | `400` — self profile cannot be deactivated |
| N4 | `POST /internal/notify/profile` with **no** HMAC headers | `401` |
| N5 | `POST /internal/notify/profile` with a bad `X-Signature` | `401` Invalid HMAC signature |

```bash
curl -s -o /dev/null -w "N1 %{http_code}\n" $BASE/profiles
curl -s -o /dev/null -w "N4 %{http_code}\n" -X POST $BASE/internal/notify/profile \
  -H 'Content-Type: application/json' -d '{"profileId":"x","body":"y"}'
```

---

## 9. One-shot automated suite

Every happy path and negative case above is scripted in
`apps/user-provider-service/test/profiles-rro.e2e.ts` — real service, real DB, no mocks.
It exits non-zero on any failure, so it works as-is in CI.

```bash
# from repo root, with service + DB up
set -a; source .env; set +a
bun run apps/user-provider-service/test/profiles-rro.e2e.ts
# → === RESULT: 28 passed, 0 failed ===
```

Override the target with env vars if needed:
`TEST_BASE_URL`, `TEST_AUTH_ID`, `TEST_EMAIL`.

*(Reset state between full runs:)*
```bash
PGPASSWORD=longeny_dev_password psql -h localhost -p 5434 -U longeny -d longeny_core \
  -c "TRUNCATE profiles, rro_state, rro_transition, caregiver_consent, caregiver_consent_audit, notification_targets, notification_log CASCADE;"
```

---

## 10. Endpoint test matrix

| Endpoint | Method | Permission | Happy | Key negatives |
|----------|--------|-----------|-------|---------------|
| `/profiles` | GET | `profiles:read` | 200, self auto-created | 401 no token, 403 no permission |
| `/profiles` | POST | `profiles:write` | 201, rroState=intake | 400 dup self, 400 bad body, 403 |
| `/profiles/:id` | GET | `profiles:read` | 200 + rroState | **404** not owner, 403 no permission |
| `/profiles/:id` | PATCH | `profiles:write` | 200 updated | **404** not owner |
| `/profiles/:id` | DELETE | `profiles:write` | 200 inactive | 400 self profile, **404** not owner |
| `/profiles/:id/activate` | POST | `profiles:write` | 200 context | 400 inactive, **404** not owner |
| `/profiles/:id/consent` | POST | `consent:grant` | 201 granted/revoked upsert | **404**, 403 without `consent:grant` |
| `/profiles/:id/consent` | GET | `profiles:read` | 200 list | **404** |
| `/profiles/:id/rro-state` | GET | `profiles:read` | 200 + history | **404** |
| `/profiles/:id/notification-targets` | POST | `profiles:write` | 201 | **404** |
| `/profiles/:id/notifications` | GET | `profiles:read` | 200 list | **404** |
| `/progress/*` | any | `progress:read` / `progress:write` | scoped to the acting profile | 403 wrong permission, **404** foreign profile in header |
| `/internal/rro-state/transition` | POST | HMAC | 200 | 401 bad/no signature, 404 profile |
| `/internal/notify/profile` | POST | HMAC | 200 delivered≥0 | 401 bad/no signature, 404 profile |

Legend: JWT = `Authorization: Bearer`; HMAC = `X-Service-Name`/`X-Timestamp`/`X-Signature`.

**404 is deliberate.** A profile owned by another account answers exactly like one that does
not exist. An earlier build returned 403 there, which told an attacker enumerating ids that
a given profile was real. Never assert 403 for an ownership failure — that assertion would
be asserting the bug.

**All profile and progress routes may also return** `429` (per-account rate limit,
120/min) and `503 REVOCATION_CHECK_UNAVAILABLE` (the revocation store could not be reached;
health-data routes fail closed rather than honour a possibly-revoked token).

---

## 11. Automated suites

Everything above can be run by hand; these run it for you. All of them use **real Postgres
and real Redis with no mocks**, and every write is confirmed by querying the database
directly rather than trusting the HTTP response — the rules are in `prep/testing/README.md`.

```bash
# From the repo root — starts what is missing, runs every suite in dependency order,
# stops only the services it started
bun run test:e2e

# Leave the services up afterwards
./scripts/run-e2e.sh --keep
```

432 checks across 8 suites. The runner refuses to run a suite against a port held by the
wrong process: Bun binds with `SO_REUSEPORT`, so a second listener on a busy port succeeds
and traffic is split silently — a green run against a stale build is worse than a failure.

| Suite | Checks | Covers |
|---|---|---|
| `apps/auth-service/test/auth-rbac.e2e.ts` | 104 | Register/login/refresh, multi-role tokens, RBAC escalation blocks, token revocation on role and password change, login lockout |
| `apps/user-provider-service/test/profiles-rro.e2e.ts` | 40 | Every profile and RRO endpoint, HMAC internal routes, permission denials, cross-account isolation, **concurrent** cross-account reads and writes |
| `apps/user-provider-service/test/profile-scoping.e2e.ts` | 54 | Two profiles under one account: separate progress, habits and goals; cross-profile delete refused; bad `X-Active-Profile-Id` |
| `apps/user-provider-service/test/compliance.e2e.ts` | 87 | Encryption at rest, PHI audit rows including denials, append-only enforcement, GDPR export and erasure verified in the database, per-account rate limiting |
| `apps/payment-service/test/payments-rbac.e2e.ts` | 39 | Refund approval guard chain, body validation, ownership 404s |
| `apps/booking-service/test/bookings-ownership.e2e.ts` | 58 | Booking ownership 404s, role vs ownership denial, validation, HMAC internal routes |
| `apps/booking-service/test/calendar-oauth-state.test.ts` | 7 | Forged, replayed, expired and tampered OAuth `state` (`bun test`) |
| `apps/gateway/test/gateway-routing.e2e.ts` | 43 | Profile proxying, `/internal/*` unreachable, forged identity headers, revoked-token handling on optional auth |

### Writing a new one

Two rules that are not obvious and cost real bugs when broken:

1. **Assert tenancy under concurrency, not just serially.** A serial test cannot see a
   request-state leak. `profiles-rro.e2e.ts` §27–28 issue interleaved requests from two
   accounts with `Promise.all` and assert each response carries its own caller's data —
   those sections fail against the build that shipped before them.
2. **Verify in the database, not in the response.** A response can be right while the row
   is wrong — that is exactly how the wrong-owner writes went unnoticed.

Suites must pass twice in a row with no manual cleanup: create your own data with unique
ids per run rather than assuming a clean database.

### Not covered by `test:e2e`

`apps/ai-content-service/tests/integration/*` need the Python agent running on
`http://localhost:8000` and a populated `longeny_ai_content` database. The database exists
locally (with the `vector` extension), but the agent is a separate process, so those suites
are excluded from the runner rather than silently skipped inside it. Start the agent and run
them directly:

```bash
cd apps/ai-content-service && bun test tests/integration/<file>.test.ts
```

They belong to Weeks 4–5. The RRO AI work in Week 7 gets its own suite against the contracts
in `packages/validators/src/rro-ai.ts`.
