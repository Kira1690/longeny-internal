# Week 7 — Intake, AI Core, Reports Timeline

Execution plan. Source rows: `RRO_MVP_Work_Plan.xlsx` seq 6–9, `RRO_Architecture_Build_Sheet.xlsx`
endpoints 10, 14–17 and DB units D5–D7, D9.

Gate for every card: [00-engineering-standards.md](./00-engineering-standards.md).
Week 6 outcome and the audit that shaped these rules: [week-06-completion.md](./week-06-completion.md),
[week-06-audit-findings.md](./week-06-audit-findings.md).

---

## 1. What the plan says, and what the repo actually has

The XLS marks endpoints 14–16 as Week 6 and 11/13 as Week 7. Week 6 shipped 11 and 13 and did
not ship 14–16, because the whole of Week 6 went into tenancy, the cross-tenant leak and the
cross-cutting remediation. The reconciliation below is what Week 7 actually owns.

| Plan row | Endpoint / unit | Where it must land | State today |
|---|---|---|---|
| seq 2 (M5, slipped from W6) | 15 `POST /intake`, 16 `GET /intake/:profileId` | ai-content | does not exist |
| seq 2 (M5, slipped from W6) | 14 `POST /ai/onboarding/session` scoped to profile | ai-content | exists, account-scoped, **no ownership check** |
| seq 6 (M9) | 17 `POST /internal/ai/classify` | ai-content | does not exist |
| seq 7 (M10) | pre-consult summary | ai-content | does not exist |
| seq 8 (M7) | report upload + timeline | ai-content `documents` | vault exists, no `profile_id`, no timeline |
| seq 9 (M8) | booking + order readiness | booking, payment | no `profile_id` on `bookings` or `orders` |
| endpoint 10 | `POST /calendar/invite` | booking | does not exist |
| D6 | `care_plans` + `plan_versions` | ai-content | does not exist (consumed Week 9) |
| D7 | `check_ins` + `adherence` | user-provider | does not exist (consumed Week 9) |
| D9 | migrations + indexes for the above | all touched | per card |
| R6 / R7 | ai-content validator convergence, error envelopes | ai-content | open from Week 6 |

### Findings from reading the code this week, before any of the above is built

These are not new features. Each one is a defect the Week 7 surface would otherwise be built
on top of, so each is attached to the card that touches that file.

| # | Finding | Evidence | Card |
|---|---|---|---|
| F1 | `GET /ai/onboarding/session/:id` has no ownership check — any authenticated account can read any onboarding session, which carries symptoms and conditions | `onboarding.controller.ts:getSession` takes `params.id` and nothing else | W7-4 |
| F2 | `recordTransition` accepts any target state; `isValidRroTransition` and `nextRroState` are exported from `@longeny/types` and called from **nowhere** | `profile.service.ts:355`; repo-wide grep returns only the definition | W7-5 |
| F3 | `BedrockService` falls back to `mockInvokeModel` when AWS fails and returns the fabricated answer as if it were real, with only a log line to say so | `bedrock.service.ts:149`, `:222` | W7-5 |
| F4 | `notifyProfile` writes `status: 'queued'` and never delivers — nothing consumes the queue | `profile.service.ts:456`; no SMTP client anywhere in the repo | W7-9 |
| F5 | ai-content has no profile context at all, so every one of its 16 owner-filtered queries is account-scoped and a dependent profile's data would land under the account owner | `profile-context.ts` exists only in user-provider | W7-3 |
| F6 | `documents.owner_id` + `owner_type` is the only scoping the vault has; a document uploaded for a parent profile is indistinguishable from the account owner's own | `schema.ts:263` | W7-7 |

---

## 2. Architecture decisions taken before building

### D-1. Ownership is resolved in one place, over HMAC

Profiles live in `longeny_core` (user-provider). Intake, documents and AI output live in
`longeny_ai_content`. Separate databases, so ai-content cannot join to `profiles`.

The rule stays in one service. user-provider gains `POST /internal/profiles/resolve`
(HMAC): given `{ authId, profileId? }` it returns the resolved profile or 404 — exactly what
`profileContext` already does locally, and through the same `assertOwnership` code path. A new
`remoteProfileContext()` in `packages/middleware` calls it and writes `activeProfileId` into
the per-request context.

Rejected: replicating the `profiles` table into ai-content (two owners of one truth), and
giving ai-content a second connection to `longeny_core` (a service that can read another
service's tables has no boundary left).

**No caching of the resolution.** One extra internal call per request is the cost; a 30-second
cache would keep answering "yes" for a profile whose consent was revoked 5 seconds ago. If the
call latency becomes a problem it is fixed with a faster lookup, not with stale authorisation.

### D-2. The classifier has two providers, and only one of them may move a profile

`RroClassifierService` composes the prompt, calls a provider, and parses the result against
`rroClassifierResponseSchema` before it is allowed anywhere near the database.

- `bedrock` — the real model. Its output may transition state when confidence ≥ 0.7.
- `rules` — a deterministic classifier over the RRO taxonomy: symptom and goal terms scored
  against pillar keyword sets, state derived from how much of the intake is filled and what it
  says. It is a genuine baseline implementation, not a stand-in for the model: it runs in
  production when Bedrock is unavailable, its output is recorded with `provider: 'rules'`,
  and **its confidence is capped below the transition floor**, so it can inform a clinician
  and can never move a profile on its own. Week 11's eval harness scores the model against it.

Both paths store the classification. Neither is allowed to store output that fails the
contract — a malformed response is a 502, not a saved row.

F3's silent mock fallback is disabled for every RRO path: if a caller asks for `bedrock` and
Bedrock is not configured, the answer is 503 `AI_UNAVAILABLE`. A fabricated clinical
classification presented as a real one is the worst failure this system can have.

### D-3. Confidence gate and transition validity are enforced server-side, twice

`mayTransitionState()` decides whether a classification may transition. Then
`recordTransition` — which any service can reach over HMAC — validates the move itself against
`isValidRroTransition` (F2). A classifier that returns `optimise` for a profile sitting in
`intake` is stored as a classification and refused as a transition.

### D-4. Provider access to reports is derived, never granted ad hoc

A provider sees a profile's documents only through an active booking or assignment. That check
belongs to booking (it owns bookings), so ai-content asks it over HMAC:
`GET /internal/bookings/access?providerId=&profileId=` → `{ hasAccess, basis }`. The existing
`document_access` grant table stays for explicit, expiring shares.

### D-5. Intake is versioned, never updated in place

`POST /intake` on an existing profile writes a new row with `version = max + 1`.
`GET /intake/:profileId` returns the latest by default, `?version=n` for a specific one. Intake
is the input to a clinical classification; overwriting it would make a stored classification
unexplainable.

---

## 3. Cards

Sized ≤10h. Owner in brackets. Caps: 6h/day, 35h/week.

### W7-1 — Profile resolution over HMAC + ai-content profile context — 8h [Vishal]
Blocks every other card. Fixes F5.

- user-provider: `POST /internal/profiles/resolve` (HMAC) → resolved profile or 404. Reuses
  `assertOwnership` / `getSelfProfileId`; no second copy of the rule.
- `packages/middleware`: `remoteProfileContext({ client })`, scoped `onBeforeHandle`, writes
  `activeProfileId` into `requestCtx(request)`. Wrong owner → **404**.
- ai-content: applied to every authenticated route group that touches patient data.

Tests: unsigned call → 401; account A asking for account B's profile → 404 identical to a
profile that does not exist; no header → the account's own `self` profile.

### W7-2 — D6 + D7 tables and indexes — 6h [Vishal]
- ai-content: `intake_submissions`, `rro_classifications`, `rro_summaries`, `care_plans`,
  `plan_versions`.
- user-provider: `check_ins`, `adherence`.
- `profile_id` on `documents` (nullable, backfilled to the owner's `self` profile).
- Indexes on every `profile_id` and on `(profile_id, created_at desc)` for the timeline reads.
- Generated migration committed with the schema change; no `db:push`.

`care_plans`, `plan_versions`, `check_ins` and `adherence` are created here per D6/D7 and are
consumed in Week 9. No endpoints for them this week.

### W7-3 — Intake API — 8h [Vishal] — endpoints 15, 16
- `POST /intake` — RRO taxonomy body from `packages/validators`: symptoms, goals, conditions,
  medications, pillar priorities. Scoped to the active profile. Versioned per D-5.
- `GET /intake/:profileId` — ownership-checked, latest or `?version=`.
- PHI audit row on both, denials included.
- Rate limited per account — it is the input to a paid model call.

Tests: intake for the father profile is invisible to the mother profile and to a second
account; version 2 does not destroy version 1; malformed body → 400 naming the field.

### W7-4 — Onboarding scoped to profile — 6h [Vishal/Pushparaj] — endpoint 14
- `POST /ai/onboarding/session` takes `profileId`; session, transcript and the
  `patient.onboarding.completed` payload all carry it.
- **F1**: `GET /ai/onboarding/session/:id` verifies the session belongs to the caller's account
  before returning it. Wrong owner → 404.
- ai-content's 16 owner-filtered query sites take `profile_id`.

Tests: two profiles onboard independently and each completion writes to the right profile; a
second account reading the first account's session id → 404.

### W7-5 — AI RRO classifier — 4h BE [Vishal] + 33h AI [Pushparaj] — endpoint 17
- `POST /internal/ai/classify` (HMAC) per D-2: intake + history + age band → contract-valid
  classification, stored with provider, confidence, contract version and prompt version.
- On a transition-eligible result, call `POST /internal/rro-state/transition` so state and
  history stay in one place.
- **F2**: `recordTransition` validates against `isValidRroTransition`; an illegal move → 422
  `INVALID_TRANSITION`, and the classification is still stored.
- **F3**: mock fallback refused on RRO paths.
- Never sends an identifier to the model — age band, never a date of birth (`RRO_GUARDRAILS`).

Tests: fixed intake fixtures produce the expected state; malformed model output is rejected,
not stored; confidence below 0.7 stores the classification and does not transition;
`intake → optimise` is refused; unsigned call → 401.

### W7-6 — AI pre-consult summary — 4h BE [Vishal] + 28h AI [Pushparaj]
- Concerns, missing data, red flags, suggested questions for a profile, stored against the
  profile with a generated-at stamp and the intake version it was derived from, so Week 8's
  workspace reads it without paying for the model again.
- `sufficientData: false` is stored as the refusal it is and never rendered as a finding.

Tests: a red-flag fixture surfaces the flag with its severity; empty intake yields the refusal,
not an invented summary; a summary is tied to the intake version that produced it.

### W7-7 — Report upload + timeline — 8h [Vishal]
- `documents` gets `profile_id`; upload and list are profile-scoped.
- `GET /profiles/:id/reports` — timeline ordered by report date, ownership-checked.
- Provider access per D-4: active booking or assignment, checked over HMAC, audited.

Tests: a presigned URL for another account's profile is refused; a provider with no booking
gets 404; the same provider after a booking gets the document and an access-log row.

### W7-8 — Booking + order readiness — 5h [Vishal]
- `profile_id` on `bookings` (19 query sites) and on `orders`; a booking made for a parent
  profile shows on that profile while payment stays on the account.
- `GET /internal/bookings/access` for D-4.

Tests: a booking for the father profile, paid by the account, appears under father only and
never under the account owner's own profile.

### W7-9 — Calendar invite for a non-user — 4h [Milan] — endpoint 10
- `POST /calendar/invite` builds a real RFC 5545 invite and sends it to a
  `notification_targets` address for a person with no login.
- **F4**: the delivery path is finished — a real SMTP transport, `notification_log` moved from
  `queued` to `sent` or `failed` with the reason.
- Local verification runs against a real mail server in Docker (mailpit), not a fake transport.

Tests: invite delivered and retrievable from the mail server; `notification_log` row written;
SMTP down → row recorded `failed`, endpoint answers 502, nothing silently lost.

### W7-10 — R6 + R7 SSOT convergence — 10h [Vishal]
- ai-content's 34 TypeBox `t.Object` sites converge on `packages/validators`, so one definition
  serves validation, Swagger and the AI contracts.
- The 9 hand-written error envelopes are replaced by `packages/errors`.
- `body: any` removed from every controller touched this week.

Tests: a malformed body on every converged route returns 400 `VALIDATION_ERROR` naming the
field, not a 500 and not a silent write.

### W7-11 — Gateway, Swagger, docs — 5h [Vishal]
- Gateway proxies for `/api/v1/intake` and the reports timeline; `/internal/*` stays unpublished.
- Every new Zod body wrapped in `documented()`; ai-content joins the gateway's merged spec.
- `docs/` gains the intake + AI contract page for frontend engineers, in the same card.

---

## 4. Hours and the AI-track overflow

| Track | Planned | Person | Cap |
|---|---|---|---|
| Backend | 8+6+8+6+4+4+8+5+10+5 = **64h** | Vishal | 35h |
| AI | 33+28 = **61h** | Pushparaj | 35h |
| DevOps | 4h | Milan | 35h |

Both tracks are over cap for one week; the XLS's own Week 7 total is 93h. This is a scheduling
fact, not a build problem, and it needs a decision before the cards go on Trello:

1. Backend: W7-10 (10h) and the D6/D7 half of W7-2 (3h) are the two pieces nothing else this
   week depends on — moving them to Week 8 brings backend to 51h, still over.
2. AI: the classifier (33h) and the summary (28h) cannot both land in one week with one AI
   developer. The classifier is the dependency for Week 8's workspace; the summary is used by
   Week 8's summary panel (seq 12). Splitting the summary across Weeks 7–8 is the smaller risk.

Both the `rules` provider (D-2) and every backend path around the model are independent of the
AI track, so backend is not blocked while that decision is pending.

---

## 5. Test plan

Rules: `prep/testing/README.md` — real Postgres, real Redis, real SMTP, database-first
verification, each suite owns its data, no mocks.

New suites, added to `scripts/run-e2e.sh` in dependency order after auth:

| Suite | Covers |
|---|---|
| `apps/ai-content-service/test/intake-rro.e2e.ts` | W7-1, W7-3, W7-4 — profile resolution, intake versioning, cross-account isolation, onboarding ownership |
| `apps/ai-content-service/test/ai-classify.e2e.ts` | W7-5, W7-6 — contract rejection, confidence gate, illegal transitions, refusals |
| `apps/ai-content-service/test/reports-timeline.e2e.ts` | W7-7 — profile scoping, provider access via booking, presigned URL refusal |
| `apps/booking-service/test/booking-profile.e2e.ts` | W7-8, W7-9 — profile-scoped bookings, invite delivery and failure |

ai-content-service joins the runner this week; it is not in it today. The runner's
`healthy_service` check (a health body that names the expected service) applies to it too —
Bun's `SO_REUSEPORT` will otherwise let it bind a port another service already holds.

Every new endpoint carries the three negative tests: no token → 401, wrong role → 403, other
account's profile → **404, never 403**. Every `/internal/*` route carries the unsigned-call 401.

---

## 6. Exit criteria

- Intake → classify → RRO state transition works end to end on real infrastructure.
- A pre-consult summary is stored for a profile and retrievable without re-running the model.
- Onboarding, documents, bookings and orders are all profile-scoped, each with a negative test.
- An illegal RRO transition is refused wherever it is attempted.
- No RRO path can return fabricated model output.
- A calendar invite reaches a real mail server and the delivery outcome is recorded.
- `bun run typecheck` 0 errors, `bun run lint` 0 errors, all suites green, Swagger clean of Zod
  internals, `docs/` updated.
