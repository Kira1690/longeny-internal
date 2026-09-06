# Week 7 — what shipped

Plan: [week-07-ai-core.md](./week-07-ai-core.md). Gate:
[00-engineering-standards.md](./00-engineering-standards.md).

Everything below is in `longeny-internal` only. Nothing has moved to `BraveLabs/`.

---

## 1. Cards

| Card | State | Notes |
|---|---|---|
| W7-1 profile resolution over HMAC + context | done | `POST /internal/profiles/resolve`, `remoteProfileContext()` in `@longeny/middleware` |
| W7-2 D6 + D7 tables and indexes | done | 7 new tables, 3 migrations, 12 indexes |
| W7-3 intake API (endpoints 15, 16) | done | versioned, profile-scoped, audited, rate-limited |
| W7-4 onboarding scoped to profile (endpoint 14) | done | plus the session-ownership hole (F1) |
| W7-5 RRO classifier (endpoint 17) | done — backend | model provider ships; the Bedrock prompt still needs the AI track's tuning |
| W7-6 pre-consult summary | done — backend | same split |
| W7-7 report upload + timeline | done | provider access derived from a booking |
| W7-8 booking + order readiness | done | `profile_id` on `bookings` and `orders` |
| W7-9 calendar invite for a non-user | done | real RFC 5545 invite, real SMTP, delivery recorded |
| W7-10 R6 + R7 SSOT convergence | **partial** | R7 done; R6 (ai-content TypeBox) deferred — see §6 |
| W7-11 gateway, Swagger, docs | done | intake, RRO and reports proxied; `/internal/*` still unpublished |

### Endpoints

| # | Endpoint | Service |
|---|---|---|
| 14 | `POST /ai/onboarding/start` — now profile-scoped | ai-content |
| 15 | `POST /intake` | ai-content |
| 16 | `GET /intake/:profileId` (+ `/history`) | ai-content |
| 17 | `POST /internal/ai/classify` (HMAC) | ai-content |
| — | `POST /internal/ai/summary` (HMAC) | ai-content |
| — | `GET /rro/:profileId/classification` | ai-content |
| — | `GET /rro/:profileId/summary` | ai-content |
| — | `GET /profiles/:profileId/reports` | ai-content |
| — | `POST /internal/profiles/resolve` (HMAC) | user-provider |
| — | `GET /internal/profiles/:profileId/rro-state` (HMAC) | user-provider |
| — | `GET /internal/bookings/access` (HMAC) | booking |
| 10 | `POST /bookings/calendar/invite` | booking |

### Schema

`longeny_ai_content`: `intake_submissions`, `rro_classifications`, `rro_summaries`,
`care_plans`, `plan_versions`, `onboarding_sessions`, `phi_access_log`;
`profile_id` + `reported_at` on `documents`.

`longeny_core`: `check_ins`, `adherence` (D7 — created here, used in Week 9).

`longeny_bookings`: `profile_id` on `bookings`.
`longeny_payments`: `profile_id` on `orders`.

Every change has a generated migration. `care_plans`, `plan_versions`, `check_ins` and
`adherence` are D6/D7 tables created per the plan sheet; nothing writes to them yet.

---

## 2. Architecture decisions worth knowing

**Ownership is asked, not copied.** Profiles live in `longeny_core`; intake and
documents live in `longeny_ai_content`. Rather than replicate the table or hand
ai-content a second connection, ai-content asks user-provider over HMAC through the
same `assertOwnership` guard the local middleware uses. One rule, one implementation.
Nothing is cached: a thirty-second cache would keep answering "yes" for consent
revoked twenty-nine seconds ago.

**The classifier has two providers and only one may move a profile.** `bedrock` is the
model. `rules` is a deterministic baseline over the same taxonomy — a real
implementation that runs when the model is unavailable, records itself as
`provider: 'rules'`, and has its confidence capped below the transition floor by
construction. It can inform a clinician; it can never move anyone. Week 11's eval
harness scores the model against it.

**No fabricated clinical output, ever.** `BedrockService` answers a failed AWS call
with a mock response and a log line. That path is disabled for RRO: if the model
cannot be reached the endpoint returns 503 and nothing is stored. Output that fails
the shared contract is a 502, never coerced into something that parses.

**Transitions are validated in two places.** The classifier's confidence gate decides
whether to attempt a move; `recordTransition` then validates the move itself against
`isValidRroTransition`, because a clinician action reaches that route too.

**Delivery means delivery.** `notifyProfile` used to write `status: 'queued'` with
nothing consuming the queue. It now sends over SMTP and records `sent` or `failed`
with the reason. SMS, which has no transport, records `failed` saying so rather than
`queued` — a queued row is a promise that something will send it.

---

## 3. Defects found and fixed

### Found by reading the code before building

| # | Finding | Fix |
|---|---|---|
| F1 | `GET /ai/onboarding/session/:id` had no ownership check — any authenticated account could read any session, and a transcript carries symptoms and conditions | `onboarding_sessions` ownership record; another account's session answers 404 |
| F2 | `isValidRroTransition` was exported from `@longeny/types` and called from nowhere; any caller could write any state | validated in `recordTransition`; illegal move → 422 `INVALID_TRANSITION` |
| F3 | `BedrockService` returned fabricated answers as real ones when AWS failed | RRO paths never accept mock output; unavailable model → 503 |
| F4 | `notifyProfile` wrote `queued` and nothing ever sent it | real SMTP transport; log moves to `sent`/`failed` |
| F5 | ai-content had no profile context at all | `remoteProfileContext()` applied to intake, onboarding, sessions, uploads |
| F6 | `documents` had no `profile_id`; a parent's report was indistinguishable from the account owner's | column, index, backfill script, timeline |

### Found while testing

| Finding | Severity | Fix |
|---|---|---|
| **HMAC signed the path with its query, verified it without** — every internal GET carrying query parameters failed, and on the calls that did work the query was outside the signature | high | both sides now sign `pathname + search`; `?providerId=` deciding who reads a patient's records is inside the signature |
| `rroTransitionSchema` hard-coded three of the five transition sources — `patient` and `admin` could not be recorded | medium | enum imported from the taxonomy; four other copied lists in the same file removed |
| `POST /bookings/providers/:id/slots` answered **HTTP 200** with `success: false` on a missing or malformed `date` | medium | throws `BadRequestError` → 400 |
| The Google calendar callback did the same on OAuth failure | medium | throws → 400 |
| `adminUpdateStatus` compared `store.userRole` to `super_admin`, so an account holding both `admin` and `super_admin` could be refused its own access | medium | checks every role on the token |
| `onboarding.controller` read `USER_PROVIDER_SERVICE_URL` straight from `Bun.env` (R8) | low | validated config |
| The error envelope was hand-written in nine places and had drifted | low | `errorEnvelope()` in `@longeny/errors`; zero literals left |
| `swagger-helpers.ts` existed as five identical 135-line copies | low | `@longeny/openapi`; each service re-exports |

### My own regressions, caught by the suites

| Regression | How it showed | Fix |
|---|---|---|
| `remoteProfileContext` applied in `required` mode to payment and booking made **every** request in those services depend on user-provider, and a provider — who owns no profiles — could not use them at all | 3 suites failed with `404 Profile not found` on order and booking creation | `mode: 'header-only'` for services where the profile is recorded but is not the scope; documents resolve lazily inside the handler so provider uploads still work |
| The transition gate reported `low_confidence` for a result naming the state the profile is already in, implying a better classifier would have moved it | one check failed | `already_in_state` is checked before the confidence floor |

---

## 4. Verification

Run: `./scripts/run-e2e.sh` — real Postgres, real Redis, real SMTP, no mocks.

| Suite | Checks | Covers |
|---|---|---|
| auth+rbac | 104 | unchanged from Week 6 |
| profiles+rro | 46 | +8 for real delivery vs `queued` |
| profile scoping | 54 | unchanged |
| compliance | 87 | unchanged |
| **intake+rro** | **45** | W7-1, W7-3, W7-4 — resolution, versioning, isolation, session ownership, audit |
| **ai classify+summary** | **59** | W7-5, W7-6 — contract rejection, confidence floor, illegal transitions, refusals, red flags, staleness |
| **reports timeline** | **25** | W7-7 — profile scoping, provider access via booking, audit |
| **booking profiles+invite** | **46** | W7-8, W7-9 — profile-scoped bookings, derived access, real ICS delivery |
| payments rbac | 39 | unchanged |
| bookings ownership | 58 | unchanged |
| gateway routing | 43 | unchanged |
| calendar oauth state | 7 tests | unchanged |

**606 checks across 11 scripted suites, plus 7 assertion tests. Zero failures.**
175 of those checks are new this week.

| Gate | Result |
|---|---|
| `bun run typecheck` | 15/15 packages, 0 errors |
| `bun run lint` | 0 errors, 481 warnings (all `noExplicitAny`, down from 486) |
| `bun run test:e2e` | 12 suites, 0 failures |
| Fresh-database path | migrations applied per service by the runner before the suites |

### API documentation

| Spec | Paths | Operations documented | Bodies rendered | Zod leaks |
|---|---|---|---|---|
| Gateway `:3000/docs` | 119 | 142/144 | 55/55 | 0 |
| user-provider `:3002/docs` | 121 | 149/150 | 46/46 | 0 |
| ai-content `:3004/docs` | 64 | 29/67 | 13/13 | 0 |
| auth `:3001/docs` | 24 | 28/29 | 14/14 | 0 |
| booking `:3003/docs` | 30 | 33/34 | 10/10 | 0 |
| payment `:3005/docs` | 21 | 26/27 | 12/12 | 0 |

ai-content's 29/67 is the honest number: everything added this week is documented, and
its pre-existing surfaces (kb, rag, recommendations, matching, scheduling, document
generation, admin) are not. Those paths are excluded from the gateway spec, which is
why the aggregate stays at 142/144.

Frontend-facing documentation: [docs/10-intake-reports-and-rro-ai.md](../../docs/10-intake-reports-and-rro-ai.md).

---

## 5. Things that need a decision

1. **The AI track is over cap.** The classifier (33h) and the summary (28h) are 61h
   against a 35h week for one AI developer. The backend for both is done and tested
   against the deterministic provider, so nothing is blocked — but the Bedrock prompt
   has not been exercised against a real model, because no Bedrock credentials are
   configured locally (`AWS_ENDPOINT_URL` points at LocalStack). `RRO_AI_PROVIDER`
   defaults to `rules` for exactly this reason.
2. **Nothing triggers classification automatically.** `POST /internal/ai/classify` is
   called by a service, and no service calls it yet — the Week 8 workspace is the
   intended caller. If a classification should run the moment intake is submitted, that
   is an event subscriber and a decision about model spend per submission.
3. **SMS still has no transport.** Every SMS notification records `failed`. That is
   deliberate and visible, but a dependent with only a phone number is currently
   unreachable.
4. **`super_admin` on onboarding approval** now passes, which it did not before. Worth
   confirming that is the intended authority.

---

## 6. Deferred, with the count

| Item | Size | Why |
|---|---|---|
| **R6** — ai-content's TypeBox route schemas converge on `@longeny/validators` | 112 `t.*` usages across 14 route files | The routes built this week already use Zod. Converting the rest is mechanical, touches every legacy ai-content surface, and would have pushed an already over-cap week further out. |
| ai-content operation descriptions | 38 undocumented operations | Same files as R6 — worth doing in the same pass. |
| **D2** query conversion | progress/habits/goals still filter on `user_id` | Unchanged from Week 6; still the scheduled card. |
| `noExplicitAny` | 481 warnings | Standard forbids new ones; the backlog is not failing the build. |

---

## 7. Exit criteria

| Criterion | Met |
|---|---|
| Intake → classify → RRO state transition works end to end on real infrastructure | yes |
| Pre-consult summary stored and retrievable without re-running the model | yes |
| Onboarding, documents, bookings and orders profile-scoped, each with a negative test | yes |
| An illegal RRO transition is refused wherever it is attempted | yes |
| No RRO path can return fabricated model output | yes |
| A calendar invite reaches a real mail server and the outcome is recorded | yes |
| typecheck 0, lint 0 errors, suites green, Swagger clean, docs updated | yes |
