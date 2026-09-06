# Engineering Standards — Non-Negotiable Gates

Applies to **every feature, every file, every card** on the RRO track and to anything
touched while working on it. A card is not done if any gate below fails, regardless of
whether the feature works.

Four axes: **Security**, **Code Quality**, **SSOT**, **RBAC**.

---

## 1. RBAC — must be end to end

### Current state (audited 2026-08-26)

| Fact | Evidence |
|---|---|
| Roles enforced coarsely | `requireRole` used 28× across services |
| Permissions modelled but never enforced | `permissions` + `role_permissions` tables exist in `auth-service/src/db/schema.ts:99,108`; `requirePermission` does not exist in `packages/middleware/src` |
| JWT carries one role, DB models many | `JwtPayload.role: UserRole` (`packages/middleware/src/auth.ts:40`) vs `PUT /auth/users/:userId/roles` (plural) |
| `payment-service` has no role guard at all | `requireRole` count = 0 |
| Ownership guard exists only for profiles | `assertOwnership` in `profile.service.ts`; no equivalent elsewhere |

### Required

- **Three layers on every protected route, in order:**
  1. `requireAuth()` — identity.
  2. `requireRole(...)` / `requirePermission(...)` — capability.
  3. Ownership/tenancy check inside the service — *this* actor may touch *this* row.
  Layer 3 is never optional. A provider having role `provider` does not mean they may open
  *this* patient.
- **Build `requirePermission(...)`** in `packages/middleware/src/auth.ts` and back it with
  the existing `role_permissions` table. Roles decide the coarse gate; permissions decide
  the fine one. Until it exists, RBAC is a claim, not a control.
- **JWT carries `roles[]` and `permissions[]`**, resolved at login from the DB. One role in
  the token while the DB models many is a silent privilege bug.
- **Deny by default.** A new route with no guard must fail review. The gateway allow-list
  is the second net, not the first.
- **Every route gets a negative test** in the same card: wrong role → 403; right role, wrong
  owner → **404** (never 403 — 403 confirms the row exists).

### RBAC matrix (fill and keep current, in this file)

| Actor | May read | May write | Never |
|---|---|---|---|
| account owner | own profiles + their data | own profiles | another account's anything |
| profile (parent, no login) | — | — | has no session at all |
| provider | assigned profiles only | notes, tasks, plans for assigned profiles | unassigned profiles, other providers' queues |
| admin | all, audited | corrections, audited | silent writes with no audit row |
| service (HMAC) | scoped to the route contract | same | any route not on the internal allow-list |

---

## 2. Security

### Findings to fix (audited 2026-08-26)

1. **PHI access is not audited.** `auditLog()` exists in `packages/middleware/src/audit.ts`
   and is applied by **zero** services. Every read of another person's health data must
   write an audit row: who, which profile, which route, when. HIPAA-relevant, and the
   client's own problem statement asks for it.
2. **Token revocation fails open.** `isBlacklisted()` returns `false` when Redis is
   unreachable (`packages/middleware/src/auth.ts:33`). During a Redis outage a revoked
   token is accepted. Decide deliberately: fail closed for PHI routes, or accept and
   document with alerting. Silent fail-open is not acceptable for the pilot.
3. **`booking-service` and `payment-service` validate nothing.** Zero request schemas;
   `createBooking` destructures `body: any` straight into the service
   (`booking.controller.ts`). Every route needs a schema before it is trusted with
   `profile_id`.
4. **Rate limiting covers only auth routes and the gateway global.** Profile creation,
   intake submission, AI classify and document generation are all cost- or abuse-sensitive
   and need their own limits.
5. **25 direct `Bun.env` / `process.env` reads** outside `packages/config`. Secrets and
   endpoints must come from validated config, not ad-hoc env reads.

### Standing rules

- PII columns stay encrypted at rest (`phone_encrypted`, `date_of_birth_encrypted`) and are
  **stripped in every response** — `sanitizeProfile()` is the pattern; no route returns a
  raw row.
- Never return `phone_hash` or any lookup hash. It is a correlation key.
- All `/internal/*` routes are HMAC-signed, raw-body-signed, and have a 401 test.
- Errors never leak internals: no stack traces, no SQL, no row counts that confirm
  existence.
- No secret, key or connection string in either repo. `internal-notes/` and `pemKey/` only.
- Every new table holding health data gets an entry in the GDPR export and erasure paths.
  A profile that cannot be deleted is a compliance defect.

---

## 3. SSOT — one definition, one place

### Findings to fix

1. **Validators split.** `packages/validators` is used by `auth-service` and
   `user-provider-service` only. `booking-service`, `payment-service` and
   `ai-content-service` do not use it — two of them validate nothing, one uses TypeBox
   (`t.Object` × 34). Pick **Zod in `packages/validators`** as the single definition and
   converge.
2. **Error envelope hand-written in 9 places** despite `packages/errors` existing. The
   envelope shape must have exactly one definition.
3. **Config read directly from env in 25 places** instead of `packages/config`.
4. **RRO taxonomy will be defined three times** if nothing is done — DB enum, Zod
   validator, AI contract. Define the states **once** in `packages/types`, derive the
   Drizzle enum, the Zod schema and the AI JSON schema from it.

### Standing rules

- A concept is defined once and imported everywhere: enums and shared types in
  `packages/types`, request/response schemas in `packages/validators`, errors in
  `packages/errors`, env in `packages/config`, cross-service contracts in
  `packages/events`.
- DB schema is the source of truth for shape; types are derived from it
  (`InferSelectModel`), never re-typed by hand.
- The same field name means the same thing in every service. `profile_id` is always the
  subject of care; `user_id` is always the paying account.
- Docs are generated from code (Swagger via `documented()`), not written twice.
- If you need to copy a definition to make something compile, that is the bug — fix the
  package boundary instead.

---

## 4. Code Quality

- `bun run typecheck` → 0 errors. `bun run lint` → clean. Both, in the service you touched,
  before the card moves.
- **No `any` in new code.** `body: any` in controllers is the current pattern in
  booking/payment and must not spread to RRO code. Types come from the validator schema.
- Layering is fixed: **route** (schema + guards only) → **controller** (shape in/out) →
  **service** (all business rules, all ownership checks) → **repository/db**. No DB query
  in a controller. No business rule in a route.
- Ownership checks live in the service layer, at one choke point per resource, the way
  `assertOwnership` does — not scattered across handlers.
- No dead code, no commented-out blocks, no `console.log` — use the request logger.
- Indexes are part of the schema change, not a later task. A `profile_id` column without an
  index on it is an incomplete migration.
- Migrations are generated and committed. `db:push` is a local convenience, never the
  record.
- Every card ships its tests in the same card. Real Postgres and Redis, no mocks.
- Comment density matches the surrounding file. Explain *why*, never *what*.

---

## Per-card checklist

Copy into every Trello card:

- [ ] `requireAuth` + role/permission guard + service-layer ownership check
- [ ] Negative tests: wrong role → 403, wrong owner → 404, no token → 401
- [ ] Request body validated by a schema from `packages/validators`
- [ ] Response sanitised — no encrypted columns, no hashes, no internal ids
- [ ] Audit row written for any PHI read or write
- [ ] Rate limit considered and applied if the route is abuse- or cost-sensitive
- [ ] Types/enums/errors/config imported, not redefined
- [ ] Index + generated migration committed with the schema change
- [ ] `typecheck` 0 errors, `lint` clean, E2E green on real infrastructure
- [ ] Swagger body wrapped in `documented()`, `docs/` updated
- [ ] No `any`, no `console.log`, no secrets, no Claude references
