# Week 6 — RRO Foundations (close-out)

Plan rows: A1–A7, D1–D5, D9, endpoints 1–9, 11–13.

## Status — 2026-08-26

| Item | State |
|---|---|
| 6.1 Expose profiles through the gateway | **Done** — authenticated proxy, `/internal/*` still closed |
| 6.2 Active-profile context header | **Done** — `profileContext` middleware; own profile 200, foreign 404 |
| 6.3 D2 stage 1 — profile scoping inside user-provider | **Partly** — columns, middleware, indexes and backfill done; the queries still filter on `user_id` |
| 6.4 D9 — migrations, indexes, seed | **Done** — baseline migrations for all 5 services, 15 indexes, fresh-DB run verified |
| 6.5 A4 — parent delivery design | **Done** — [a4-parent-delivery-design.md](./a4-parent-delivery-design.md); 9 decisions recorded, 3 provider choices still need Milan |
| 6.6 A6 — AI prompt contracts | **Done** — `packages/validators/src/rro-ai.ts` (classifier, summary, refusal, guardrails, v1) with the taxonomy in `packages/types/src/rro.ts` |
| 6.7 R1+R2 — permissions + multi-role tokens | **Done** — `requirePermission`, `resolveIdentity`, tokens carry `roles[]`/`permissions[]` |
| 6.8 R3 — PHI audit trail | **Done** — `phi_access_log`, denials recorded |
| 6.9 R4 — revocation failure mode | **Done** — fail-closed on health-data routes |

Verification: `bun run typecheck` 14/14, `bun run lint` 0 errors, 36/36 E2E on real
Postgres + Redis, and the same 36 green on a database built from migrations alone.

## Remaining

### 6.1 Expose profiles through the gateway — 4h — Vishal
The gateway declares each route explicitly (`apps/gateway/src/routes/index.ts`);
`/profiles` is absent, so nothing reaches the service from outside.

- Add authenticated proxy routes: `/profiles`, `/profiles/:id`, `/profiles/:id/activate`,
  `/profiles/:id/consent`, `/profiles/:id/rro-state`, `/profiles/:id/notifications`,
  `/profiles/:id/notification-targets`.
- `/internal/*` stays gateway-blocked (HMAC, service-to-service only).
- Test: token → gateway → profile create/list works end to end; `/internal/notify/profile`
  through the gateway returns 404.

### 6.2 Active-profile context header — 4h — Vishal
`POST /profiles/:id/activate` sets context in the service today. Downstream services need
to read it.

- Gateway forwards `X-Profile-Id` from the request (or from the activated session) to
  downstream services.
- `@longeny/middleware` gets `resolveProfile()`: reads the header, verifies the profile
  belongs to the JWT account, injects `profileId` into the handler context.
- Test: header with someone else's profile id → 404; missing header → falls back to the
  self profile.

### 6.3 D2 stage 1 — profile scoping inside user-provider — 5h remaining — Vishal
**Done so far:** nullable `profile_id` on the five tables, indexes, the
`profileContext` middleware that resolves and re-verifies `X-Active-Profile-Id`, and
`src/db/backfill-profile-ids.ts` (idempotent, verified on real rows).
**Left:** convert the reads and writes themselves.

One thing the backfill exposed: `user_id` on these tables holds the **auth_id** when the
row was written from a JWT route, and `users.id` when written service-side. The backfill
matches both; the conversion should unify them and drop the double match.

`profile_id` is nullable on `onboarding_state`, `progress_entries`, `habits`, `goals`,
`processed_events`. The read/write paths still filter on `user_id` (127 sites in this
service).

- Backfill: for every existing row, `profile_id` = the account's self profile.
- Convert reads/writes on those five tables to filter by `profile_id` via
  `resolveProfile()`. Keep `user_id` in place (account-level rows still need it).
- Test: two profiles under one account keep separate progress/habits/goals; a second
  account sees neither.

Note: booking (19), payment (26) and ai-content (16) query sites are **not** in this stage.
They are scheduled with the feature that needs them (Weeks 7–9), so the change lands with
a test that exercises it.

### 6.4 D9 — migrations, indexes, seed — 8h — Vishal/Milan
- `bun run db:generate` to produce real migration files; `src/db/migrations/` is empty
  today and the schema only exists because of `db:push`. Nothing is reproducible on the
  dev EC2 without this.
- Indexes: the schema declares none (`index()` count = 0). Add at minimum
  `profiles(user_id)`, `caregiver_consent(profile_id)`, `rro_state(profile_id)`,
  `rro_transition(profile_id, created_at)`, `notification_log(profile_id, created_at)`,
  and `profile_id` on every table from 6.3.
- Seed: one account with self + father + mother profiles for local and E2E use.
- Test: drop the database, run migrations from empty, run the 29-check E2E, all green.

### 6.5 A4 — parent delivery design — 4h — Milan/Vishal
`notification_targets` and `notification_log` exist; nothing sends. Decide and write down:
SMS provider, email sender identity, calendar invite mechanism for a person with no login,
retry policy, and what a `failed` row means operationally. Output is a short doc in this
folder, not code.

### 6.6 A6 — AI prompt contracts + JSON schemas — 12h — Pushparaj
Blocks all of Week 7. Deliver as versioned schema files in the repo:
- RRO classifier: input (intake + history) → output `{ state, confidence, pillar_priorities[], rationale }`
- Pre-consult summary: input (profile + intake + reports) → output
  `{ concerns[], missing_data[], red_flags[], suggested_questions[] }`
- Guardrails: refusal shape, no-diagnosis rule, what happens on low confidence.

### 6.7 R1+R2 — real RBAC: permissions + multi-role tokens — 10h — Vishal
`permissions` and `role_permissions` are live tables that nothing reads. Every guard in the
repo is `requireRole`, and the JWT carries a single `role` while the auth API assigns roles
plural.

- Add `requirePermission(...)` to `packages/middleware/src/auth.ts`, resolved from
  `role_permissions`, cached in Redis with an explicit TTL and an invalidation hook on
  role/permission change.
- Login resolves `roles[]` and `permissions[]` into the JWT; `requireRole` keeps working
  against `roles[]` for backward compatibility.
- Apply `requirePermission` to the profile routes first (`profile:read`, `profile:write`,
  `consent:grant`), then to every new RRO route as it lands.
- Test: user with two roles gets both in the token; permission removed at the DB →
  next request after TTL is refused; role guard and permission guard both fire.

### 6.8 R3 — PHI audit trail — 6h — Vishal
`auditLog()` is written and applied by no service.

- Apply on every profile route and every `/internal/*` route: actor, profile_id, route,
  method, outcome, timestamp.
- Rows go to an append-only table; no update or delete path exists.
- Test: reading another profile's data writes an audit row; a refused request is audited
  too (a denied access attempt is the row that matters most).

### 6.9 R4 — decide the revocation failure mode — 2h — Vishal/Milan
`isBlacklisted()` swallows Redis errors and returns `false`, so a revoked token is honoured
during an outage.

- Fail **closed** on PHI routes (profiles, intake, reports, workspace); keep fail-open only
  on non-PHI reads if we decide the availability tradeoff is worth it.
- Alert on the fallback path so an outage is visible instead of silent.
- Test: Redis down → PHI route with a revoked token is refused.

## Week 6 exit criteria
- Profiles reachable through the gateway with an auth token.
- Fresh database → migrate → seed → 29-check E2E green.
- Two profiles under one account have separate onboarding/progress/habits/goals.
- AI contracts committed so Week 7 can start.
- `requirePermission` exists and guards the profile routes; tokens carry `roles[]` and
  `permissions[]`.
- Every profile and internal route writes an audit row, including denials.
- Revocation failure mode decided, implemented and tested.

## Week 6 revised hours

| Item | Hours |
|---|---|
| 6.1 gateway expose | 4 |
| 6.2 profile context header | 4 |
| 6.3 D2 stage 1 | 8 |
| 6.4 migrations + indexes + seed | 8 |
| 6.5 A4 delivery design (Milan) | 4 |
| 6.6 A6 AI contracts (Pushparaj) | 12 |
| 6.7 RBAC permissions + multi-role tokens | 10 |
| 6.8 PHI audit trail | 6 |
| 6.9 revocation failure mode | 2 |
| **Vishal (backend)** | **34** — at the 35h cap |
| **Pushparaj (AI)** | **12** |
| **Milan (DevOps)** | **6** |

6.9 is shared Vishal/Milan; if Vishal's load slips past 34h, 6.5 and 6.9 move wholly to
Milan before anything is cut.
