# RRO Multi-Profile Build — Execution Plan (Weeks 6–12)

> **Start at [CARRY-FORWARD.md](./CARRY-FORWARD.md).** It is the single register of
> everything not yet built — blocked items and who they wait on, fixed-but-unshipped work,
> deferrals with their reasons, and the facts that keep getting re-derived. Read it before
> any week planning; it is newer than the week files below.

Source of truth for this track:
- `prep/RRO_Architecture_Build_Sheet.xlsx` — architecture (A1–A7), DB (D1–D9), 32 endpoints, Week-6 Trello
- `prep/RRO_MVP_Work_Plan.xlsx` — Week 6–11 task list, hours, Backend/AI split
- `prep/RRO_Multi_Profile_Justification.xlsx` — client-facing justification for the extension

Build repo: `longeny-internal/` only. Nothing moves to `BraveLabs/` until its Trello card
is verified done (see root `CLAUDE.md`).

---

## Status at 2026-08-27

| Plan area | Planned | Done | Remaining |
|---|---|---|---|
| Architecture design A1–A7 | 7 units | **all 7** | — |
| Database D1–D9 | 9 units | D1, D3–D7, D9 | D2 (partial), D8 |
| API endpoints | 32 | 16 | 16 — all Week 8+ |
| AI track | classifier, summary, eval | classifier + summary **backend**, with a deterministic provider; model prompts untuned | Bedrock tuning, eval harness (Week 11) |
| Tests | — | 11 E2E suites, 606 checks, real Postgres/Redis/SMTP | Weeks 8–11 surfaces |

### Built and tested (Weeks 6–7)

Service `user-provider-service`:

| # | Endpoint | State |
|---|---|---|
| 1 | `POST /profiles` | done |
| 2 | `GET /profiles` | done |
| 3 | `GET /profiles/:id` | done |
| 4 | `PATCH /profiles/:id` | done |
| 5 | `DELETE /profiles/:id` | done |
| 6 | `POST /profiles/:id/activate` | done (service-level; not exposed on gateway) |
| 7 | `POST /profiles/:id/consent` | done |
| 8 | `GET /profiles/:id/consent` | done |
| 11 | `GET /profiles/:id/notifications` | done |
| 12 | `GET /profiles/:id/rro-state` | done |
| 13 | `POST /internal/rro-state/transition` | done (HMAC) |
| 9 | `POST /internal/notify/profile` | done (HMAC) |
| — | `POST /profiles/:id/notification-targets` | done (extra, covers D5) |

Week 7 added, across `ai-content-service`, `booking-service` and `user-provider-service`:

| # | Endpoint | State |
|---|---|---|
| 14 | `POST /ai/onboarding/start` — profile-scoped | done |
| 15 | `POST /intake` | done |
| 16 | `GET /intake/:profileId` (+ `/history`) | done |
| 17 | `POST /internal/ai/classify` (HMAC) | done |
| 10 | `POST /bookings/calendar/invite` | done |
| — | `POST /internal/ai/summary` (HMAC) | done |
| — | `GET /rro/:profileId/classification` · `GET /rro/:profileId/summary` | done |
| — | `GET /profiles/:profileId/reports` | done |
| — | `POST /internal/profiles/resolve` (HMAC) | done |
| — | `GET /internal/profiles/:profileId/rro-state` (HMAC) | done |
| — | `GET /internal/bookings/access` (HMAC) | done |

Tables live in `longeny_core`: `profiles`, `caregiver_consent`,
`caregiver_consent_audit`, `rro_state`, `rro_transition`, `notification_targets`,
`notification_log`, `phi_access_log`, `check_ins`, `adherence`.
In `longeny_ai_content`: `intake_submissions`, `rro_classifications`, `rro_summaries`,
`care_plans`, `plan_versions`, `onboarding_sessions`, `phi_access_log`.
Nullable `profile_id` on `onboarding_state`, `progress_entries`, `habits`, `goals`,
`processed_events`, `documents`, `bookings`, `orders`.

Verification: `./scripts/run-e2e.sh` — 11 suites, 606 checks, plus 7 assertion tests,
against real Postgres, Redis and SMTP. Typecheck clean, lint clean.

### Known gaps carried forward

1. ~~Gateway does not expose `/profiles`.~~ **Fixed** — authenticated proxy for
   `/api/v1/profiles` and `/api/v1/profiles/*`; `/internal/*` deliberately still absent.
2. **`profile_id` scoping is now cross-service.** Week 7 added it to ai-content
   (`documents`, `intake_submissions`, `rro_*`, `onboarding_sessions`), booking
   (`bookings`) and payment (`orders`), with `remoteProfileContext()` resolving
   ownership through one rule. The **query** conversion on progress/habits/goals is
   still open → D2.
3. ~~No migration files.~~ **Fixed** — baseline migrations for all five services;
   fresh-database run verified end to end.
4. ~~No indexes anywhere in the schema.~~ **Fixed** for the tenancy surface (15 indexes);
   the rest of the schema is still unindexed.
5. ~~**Cross-tenant isolation tests** exist only for profiles.~~ **Extended** — every
   service that took `profile_id` this week has its own cross-account suite against a
   real second account.
6. ~~RBAC stops at role level.~~ **Fixed** — permissions enforced; ownership checks still
   exist only for profiles, so each new resource needs its own.
7. ~~No PHI audit trail.~~ **Fixed** — `phi_access_log`, denials included.

---

## Cross-cutting remediation (audited 2026-08-26)

Standards and the full evidence: [00-engineering-standards.md](./00-engineering-standards.md).
These are not RRO features — they are gaps the RRO work would otherwise inherit and spread.
Scheduled here so they land before the surface grows.

| # | Gap | Status |
|---|---|---|
| R1 | `requirePermission` did not exist; permissions modelled but never enforced | **Fixed** — `permissionGuard` / `requirePermission` in `packages/middleware`, applied to profiles, payments, bookings, subscriptions |
| R2 | JWT carried one `role` while the DB models many | **Fixed** — `resolveIdentity()` is the single resolver; tokens carry `roles[]` + `permissions[]`; `requireRole` checks all roles |
| R3 | PHI access not audited; `auditLog()` used by 0 services | **Fixed** — durable `phi_access_log` table + sink; profile and progress routes audited, denials included |
| R4 | Token revocation failed open when Redis was down | **Fixed** — `onRevocationCheckFailure: 'closed'` on health-data routes; unknown → 503, not silent allow |
| R5 | `booking-service` + `payment-service` validated no request bodies | **Fixed** — every write route has a Zod body from `@longeny/validators` |
| R6 | Validators split: Zod pkg / TypeBox / none | **Partly fixed** — booking, payment and every route built in Week 7 use the Zod package; ai-content's legacy routes (112 `t.*` usages) still to converge — see [week-07-completion.md §6](./week-07-completion.md) |
| R7 | Error envelope hand-written in 9 places | **Fixed** — `errorEnvelope()` in `@longeny/errors`; zero literals left |
| R8 | Direct env reads outside `packages/config` | **Fixed** for the ones that mattered — every `db/index.ts` and all 8 payment modules now read validated config; a missing var fails at boot |
| R9 | `payment-service` had no role guard at all | **Fixed** — and `PUT /refunds/:id/approve` was reachable by any authenticated user; now admin role + `payments:refund` |
| R10 | Rate limiting only on auth routes + gateway global | **Fixed** for profiles — per-account limiter (120/min), verified returning 429; other surfaces as they ship |

### Fixed along the way (not on the original list)

| Gap | Status |
|---|---|
| `bun run typecheck` failed at workspace resolution, so CI never typechecked anything | **Fixed** — `packageManager` field + 8 package tsconfigs; 14/14 packages green |
| 36 pre-existing type errors hidden behind that failure (booking 11, ai-content 25) | **Fixed** — including a Google Calendar call that matched the callback overload and read `.data` off `void` |
| `bun run lint` reported 353 errors | **Fixed** — 0 errors (486 `noExplicitAny` warnings remain, tracked below) |
| Gateway forwarded caller-supplied `X-User-*` headers on unauthenticated routes | **Fixed** — identity headers deleted when the request is not authenticated |
| Ownership guard answered 403 for another account's profile, confirming it exists | **Fixed** — 404, indistinguishable from a missing profile |
| No migration files anywhere; schema existed only via `db:push` | **Fixed** — baseline migrations generated for all 5 services; verified fresh DB → migrate → 36/36 E2E |
| No indexes in any schema | **Fixed** for the tenancy surface — 15 indexes on `profile_id` / account / audit paths |
| First authenticated request after boot failed the revocation lookup (lazy Redis client) | **Fixed** — shared connect promise; found by running the suite against a fresh database |
| `user_id` means auth_id on progress tables and users.id elsewhere | Open — backfill matches both; unifying is part of the D2 card |

### Still open

- **481 `noExplicitAny` lint warnings**, mostly `({ body, store }: any)` in controllers. Not
  failing the build; the standard forbids new ones.
- **D2 query conversion** — `profile_id` columns, middleware and backfill are in place, but
  the progress/habits/goals queries still filter on `user_id`. That is the scheduled card.
- **R6** — ai-content's legacy routes still declare TypeBox schemas (112 `t.*` usages
  across 14 files) and 38 of its operations carry no description. Everything built in
  Week 7 is on Zod and documented.
- **SMS has no transport.** Every SMS notification records `failed` with that reason.
  Deliberate and visible, but a dependent reachable only by phone is not reachable.
- **The RRO model prompts are untuned.** `RRO_AI_PROVIDER` defaults to the
  deterministic `rules` provider; Bedrock has never been exercised locally because no
  credentials are configured.

## Week 7 outcome

Complete on the backend. See [week-07-completion.md](./week-07-completion.md) — 12
cards, 12 endpoints, 7 new tables, 175 new E2E checks, and 14 defects fixed (6 found
by reading the code, 6 by the tests, 2 of my own regressions).

The one worth reading: **HMAC signed the request path with its query string and
verified it without.** Every internal GET carrying query parameters failed, and on the
calls that did work the query was outside the signature — including the
`?providerId=&profileId=` that decides whether a clinician may read a patient's
records.

## Week 6 outcome

Complete. See [week-06-completion.md](./week-06-completion.md) for what shipped and
[week-06-audit-findings.md](./week-06-audit-findings.md) for the adversarial audit — 16
findings, two critical, all fixed and verified.

The critical one is worth every engineer on this project reading once: Elysia's `.state()`
store is shared across concurrent requests, so identity written into it leaked between
callers. Two accounts using the platform at the same moment read and wrote each other's
health data. Every isolation test passed against it, because they ran serially.

## Week files

| Week | File | Theme |
|---|---|---|
| 6 | [week-06-foundations.md](./week-06-foundations.md) | tenancy close-out, gateway, D2 stage 1, D9 |
| 7 | [week-07-ai-core.md](./week-07-ai-core.md) · [completion](./week-07-completion.md) | intake, classifier, pre-consult summary, reports timeline |
| 8 | [week-08-workspace.md](./week-08-workspace.md) | clinician queue + patient workspace + gateway re-open |
| 9 | [week-09-care-plans-checkins.md](./week-09-care-plans-checkins.md) | document/care-plan builder, check-ins, adherence |
| 10 | [week-10-dashboards-reporting.md](./week-10-dashboards-reporting.md) | user dashboard, outcomes, reporting |
| 11 | [week-11-integration-qa.md](./week-11-integration-qa.md) | E2E family flows, AI eval, hardening |
| 12 | [week-12-pilot-readiness.md](./week-12-pilot-readiness.md) | backend tail, security pass, production deploy, handover |

Open design awaiting a scope decision:
[care-team-model.md](./care-team-model.md) — a patient's care team (lead clinician plus
nutrition/coach/ancillary) has no model at all; Week 8 §8.1 and §8.2 assume one exists.

[verified-consent-design.md](./verified-consent-design.md) — consent is self-attested by
the caregiver today; the patient is never asked.

Scheduling, per person and per week:
[week-07-schedule.md](./week-07-schedule.md) ·
[capacity-weeks-07-12.md](./capacity-weeks-07-12.md)

## Rules for every week

0. **[00-engineering-standards.md](./00-engineering-standards.md) is the gate.** Security,
   code quality, SSOT and RBAC are checked per card, not at the end. Its per-card checklist
   goes into every Trello card.
1. Build in `longeny-internal/`. Test locally against real Postgres/Redis. No mocks.
2. Gate before a card is done: `bun run typecheck` → 0 errors, `bun run lint` clean,
   the week's E2E suite green, service boots and `/health` responds.
3. Every new profile-scoped endpoint ships with three negative tests: no token → 401,
   wrong role → 403, other account's profile → **404** (never 403 — 403 confirms the row
   exists).
4. Every new `/internal/*` route is HMAC-guarded and has a 401 test.
5. Swagger: every Zod body wrapped in `documented()` (see `routes/swagger-helpers.ts`).
6. Docs: add/extend the matching file in `longeny-internal/docs/` in the same card.
7. Trello cards ≤10h, ≤6h/day, ≤35h/week/person; discuss the card list before creating.
