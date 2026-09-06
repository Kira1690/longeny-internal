# Week 6 — Completion Report

Multi-profile / family (RRO) tenancy foundations. Built in `longeny-internal`, tested
against real Postgres and Redis, nothing migrated to the client repo.

Companion documents:
- [week-06-foundations.md](./week-06-foundations.md) — the plan this delivers against
- [week-06-audit-findings.md](./week-06-audit-findings.md) — the adversarial audit and every finding
- [00-engineering-standards.md](./00-engineering-standards.md) — the gate each card was judged against
- [a4-parent-delivery-design.md](./a4-parent-delivery-design.md) — A4 decisions
- `docs/09-auth-permissions-and-profile-context.md` — the frontend-facing contract

---

## 1. What the model is now

One authenticated **account** owns many **profiles**. A profile is the subject of care —
the account owner themselves, or a dependent such as a parent who has no login and never
will. Health data belongs to a profile, not to the account that pays.

Three layers guard every protected route, in this order:

1. `requireAuth` — who is calling, and is the token still valid
2. `requireRole` / `permissionGuard` — may this kind of actor do this kind of thing
3. a service-layer ownership check — may *this* actor touch *this* row

Layer 3 is never optional and is the one that makes tenancy real. A row that exists but
belongs to another account answers exactly like a row that does not exist — 404, never 403.

---

## 2. Delivered

### Architecture (A1–A7) — all seven

| Unit | Delivered as |
|---|---|
| A1 Multi-tenant model | `profiles` table, account → profiles, dependents with no credentials |
| A2 Profile-scoped data | `profile_id` on onboarding, progress, habits, goals, check-ins |
| A3 Active-profile context | `profileContext` middleware, `X-Active-Profile-Id`, re-verified per request |
| A4 Parent notification | [design document](./a4-parent-delivery-design.md), 9 decisions |
| A5 RRO state model | `rro_state` + `rro_transition`, taxonomy in `packages/types/src/rro.ts` |
| A6 AI contracts | `packages/validators/src/rro-ai.ts` — classifier, summary, refusal, guardrails, v1 |
| A7 Caregiver consent | `caregiver_consent` + append-only `caregiver_consent_audit` |

### Database (D1–D9)

Ten tables carry the tenancy model; 15 indexes cover the profile, account and audit paths
(the schema previously had none anywhere). Three migrations, applied from an empty database
and verified end to end. `src/db/backfill-profile-ids.ts` is idempotent and gives every
pre-tenancy row a profile.

### Endpoints — 13 live

`POST|GET /profiles`, `GET|PATCH|DELETE /profiles/:id`, `POST /profiles/:id/activate`,
`POST|GET /profiles/:id/consent`, `GET /profiles/:id/rro-state`,
`POST /profiles/:id/notification-targets`, `GET /profiles/:id/notifications`, and two
HMAC-only internal routes (`/internal/rro-state/transition`, `/internal/notify/profile`).
All reachable through the gateway except the internal pair, which are not exposed and never
will be.

### Scoped surfaces

`/progress/*` (entries, habits, goals, check-ins) and `/users/me/onboarding` now belong to
the acting profile. Two family members under one account share nothing.

---

## 3. Security work

The tenancy model was audited adversarially before being called done. Sixteen findings, two of them
critical, plus eight more defects the audit prompted. All are fixed; the full register with evidence is in
[week-06-audit-findings.md](./week-06-audit-findings.md).

The one worth reading in full is **C1**: Elysia's `.state()` store is shared across all
in-flight requests, so request identity written into it leaked between concurrent callers.
Two accounts using the platform at the same moment read and wrote each other's family
health records — 12 of 24 concurrent reads and 6 of 8 concurrent writes crossed accounts.
No attacker was required.

Every isolation test passed against that build, because they ran serially. **A test that
asserts tenancy must assert it under overlap**; the suites now do, and they fail against the
old build.

Also fixed: an audit log that attributed breaches to the victim, plaintext phone numbers
stored beside their own ciphertext, an OAuth path that took over accounts by email match, an
admin self-escalation to super_admin, role and password changes that left old tokens
privileged, a calendar-link hijack via a forgeable OAuth `state`, refund approval reachable
by any authenticated user, GDPR erasure that skipped every RRO table, and audit tables that
were documented append-only but freely mutable.

---

## 4. Verification

`bun run test:e2e` starts whatever is not already running, runs every suite in dependency
order, and stops only what it started. All of it against real Postgres and Redis — no
mocks, no stubbed services, and every write confirmed by querying the database rather than
by trusting the response.

| Suite | Checks | What it holds down |
|---|---|---|
| `auth-service/test/auth-rbac.e2e.ts` | 104 | register/login/refresh, multi-role tokens, escalation refusals, revocation on role and password change, lockout, blacklist |
| `user-provider-service/test/compliance.e2e.ts` | 87 | encryption at rest, PHI audit including denials, append-only enforcement, GDPR export and erasure, per-account limits, concurrency |
| `booking-service/test/bookings-ownership.e2e.ts` | 58 | ownership 404s byte-equal to a ghost id, role-vs-ownership, validation, HMAC, full lifecycle |
| `user-provider-service/test/profile-scoping.e2e.ts` | 55 | two profiles under one account, cross-profile delete refused, bad `X-Active-Profile-Id` |
| `gateway/test/gateway-routing.e2e.ts` | 43 | proxying, `/internal/*` unreachable, forged identity headers, revoked tokens on optional auth |
| `user-provider-service/test/profiles-rro.e2e.ts` | 41 | every profile and RRO endpoint, HMAC, **concurrent** cross-account reads and writes |
| `payment-service/test/payments-rbac.e2e.ts` | 39 | refund guard chain, body validation, ownership equality |
| `booking-service/test/calendar-oauth-state.test.ts` | 7 | forged, replayed, expired and tampered OAuth `state` |

| Gate | Result |
|---|---|
| `bun run typecheck` | 14/14 packages, 0 errors |
| `bun run lint` | 0 errors (449 `noExplicitAny` warnings in untouched controllers) |
| `bun run test:e2e` | **8 suites, 432 checks, 0 failures** |
| Fresh database → migrate → append-only trigger → suites | green on first run, from empty, no `db:push` |
| Cross-tenant probe | 0/24 reads, 0/6 writes crossed accounts (was 12/24 and 6/8) |
| Concurrent HMAC internal calls | 0/24 correctly-signed calls wrongly rejected |

### API documentation

Every service now publishes an OpenAPI spec, and the gateway merges them into the one a
client actually calls.

| Spec | Paths | Operations documented | Bodies as real JSON Schema | Zod leaks |
|---|---|---|---|---|
| Gateway (`:3000/docs`) | 112 | 122 / 137 | 51 / 53 | 0 |
| user-provider (`:3002/docs`) | 119 | 134 / 148 | 45 / 45 | 0 |
| auth (`:3001/docs`) | 24 | 27 / 29 | 14 / 14 | 0 |
| booking (`:3003/docs`) | 28 | 31 / 32 | 9 / 9 | 0 |
| payment (`:3005/docs`) | 21 | 26 / 27 | 10 / 12 | 0 |

booking and payment had **no spec at all** before this week. user-provider went from 13
fully documented operations to 134. The gateway spec no longer advertises the nine
`/internal/*` paths it cannot route.

Worth stating plainly: the repo-wide typecheck had **never run** before this week — turbo
failed at workspace resolution, so CI's lint-and-typecheck job checked nothing. Fixing that
exposed 36 real type errors that had been invisible.

---

## 5. Not done, and why

| Item | Why it is not done |
|---|---|
| `user_id` means auth_id on some tables, `users.id` on others | Needs its own migration and a careful sweep; the backfill matches both meanwhile |
| `health_profiles` has no `profile_id` | An intake for a dependent still overwrites the owner's clinical record. Schema change, Week 7 |
| Service connects to Postgres as a superuser | The append-only trigger cannot bind a superuser. A least-privilege role is Milan's infrastructure change |
| 452 `noExplicitAny` warnings | In controllers this work did not touch. The standard forbids new ones |
| A4 provider choices | SMS provider, DLT templates and SES production access are decisions plus lead time, not code |
| ai-content still on TypeBox (34 sites) | Week 7, with the intake work that touches those routes |

---

## 6. What Week 7 can now assume

- A request names its subject of care, and the platform proves the caller may act as it.
- Health data written for one profile is invisible to every other.
- Permissions are enforced, not merely modelled.
- Every health-data access, including refusals, leaves a row that cannot be edited.
- The AI contracts exist, so the classifier and pre-consult summary can be built against a
  fixed shape rather than negotiated mid-sprint.
