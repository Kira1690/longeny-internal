# Week 7 — Card List and Schedule

Week runs **Mon 2026-09-07 → Sat 2026-09-12**.

Cards are the RRO deliverables from [week-07-ai-core.md](./week-07-ai-core.md) §3, sized to
fit the caps. Nothing here is process work: committing, migrating to `BraveLabs/` and
updating docs are the **definition of done on every card** (root `CLAUDE.md`), not cards of
their own.

Gate for every card: [00-engineering-standards.md](./00-engineering-standards.md).

---

## 1. Capacity

The cap is 6h/day and 35h/week. Those reconcile only on a six-day week — 5 × 6 = 30h. This
schedule assumes **Mon–Fri 6h, Sat 5h**.

| Person | Role | Allocated | Cap |
|---|---|---|---|
| Vishal | Backend | 35h | 35h |
| Pushparaj | AI | 35h | 35h |
| Milan | DevOps | 16h | 20h |
| Vijay | Architect | 14h | — |
| **Total** | | **100h** | |

The plan's backend demand for Week 7 is **64h** and its AI demand is **61h**. Neither fits
one person in one week; the plan itself flags this in §4. What does not fit is named in §6
below rather than quietly dropped.

---

## 2. Vishal — Backend — 35h

### W7-1 — Profile resolution over HMAC + ai-content profile context — 8h

**Goal.** ai-content cannot answer "does this profile belong to this caller" — profiles
live in `longeny_core`, intake and documents live in `longeny_ai_content`, and there is no
join between them. Today every ai-content query is account-scoped, so a dependent's data
lands under the account owner. One service must own the ownership rule.

**Delivers**
- `POST /internal/profiles/resolve` (HMAC) on user-provider — `{ authId, profileId? }` →
  resolved profile or 404, through the existing `assertOwnership` path. No second copy of
  the rule.
- `remoteProfileContext()` in `packages/middleware` — scoped `onBeforeHandle`, writes
  `activeProfileId` into `requestCtx(request)`.
- Applied to every authenticated ai-content route that touches patient data.

**Done when**
- An unsigned call to the resolve route returns 401.
- Account A asking for account B's profile returns **404**, byte-identical to the response
  for a profile that does not exist.
- No `X-Active-Profile-Id` header resolves to the caller's own `self` profile.
- No resolution is cached — a revoked consent takes effect on the next request, not 30
  seconds later.

**Blocks** W7-3, W7-4, W7-5, W7-6.

---

### W7-2 — D6 tables, indexes and migrations — 5h

**Goal.** The AI surface has nowhere to write. Intake, classifications and summaries need
a stable shape before anything generates them, and the reads are all
`(profile_id, created_at desc)`.

**Delivers**
- `intake_submissions`, `rro_classifications`, `rro_summaries` in `longeny_ai_content`.
- `profile_id` on `documents`, nullable, backfilled to the owner's `self` profile.
- Index on every `profile_id`, plus `(profile_id, created_at desc)` for timeline reads.
- Generated migrations committed with the schema change.

**Done when**
- A fresh database reaches the current schema by migration alone — no `db:push`.
- `EXPLAIN` on the timeline read uses the composite index, not a sequential scan.

**Note.** D7 (`check_ins`, `adherence`) and `care_plans` / `plan_versions` are consumed in
Week 9 and move there — the plan's own §4 names them as the piece nothing this week depends
on.

---

### W7-3 — Intake API — 8h — endpoints 15, 16

**Goal.** Intake is the input to a clinical classification. Without it the classifier has
nothing to classify, and Week 8's workspace has nothing to show a clinician.

**Delivers**
- `POST /intake` — RRO taxonomy body from `packages/validators`: symptoms, goals,
  conditions, medications, pillar priorities. Scoped to the active profile.
- `GET /intake/:profileId` — latest by default, `?version=n` for a specific one.
- **Versioned, never updated in place** — a resubmission writes `version = max + 1`.
  Overwriting intake would make a stored classification unexplainable.
- PHI audit row on read and write, denials included.
- Per-account rate limit — this is the input to a paid model call.

**Done when**
- The father profile's intake is invisible to the mother profile and to a second account.
- Version 2 does not destroy version 1, and version 1 is still readable.
- A malformed body returns 400 naming the field, not a 500 and not a silent write.

---

### W7-4 — Onboarding scoped to profile — 6h — endpoint 14

**Goal.** Onboarding writes to the account, not the person. A daughter onboarding her
father today files his symptoms under herself. Separately,
`GET /ai/onboarding/session/:id` has **no ownership check at all** — any authenticated
account can read any session, and a transcript carries symptoms and conditions.

**Delivers**
- `POST /ai/onboarding/start` takes `profileId`; session, transcript and the
  `patient.onboarding.completed` payload all carry it.
- Ownership record on `onboarding_sessions`; the read route verifies it.
- ai-content's 16 owner-filtered query sites take `profile_id`.

**Done when**
- Two profiles onboard independently and each completion writes to the right profile.
- A second account reading the first account's session id gets **404**.

---

### W7-5 — RRO classifier backend + transition gate — 4h — endpoint 17

**Goal.** Turn intake into a care-pathway state, and make sure only a result that earns it
can move a patient. Two providers exist so the platform is not dead when the model is:
`bedrock` is the model; `rules` is a deterministic baseline whose confidence is capped below
the transition floor by construction, so it can inform a clinician and can never move
anyone.

**Delivers**
- `POST /internal/ai/classify` (HMAC) — intake + history + **age band** (never a date of
  birth) → a result validated against `rroClassifierResponseSchema` before it goes near the
  database.
- Transition-eligible results call `POST /internal/rro-state/transition`, so state and
  history stay in one place.
- `recordTransition` validates the move against `isValidRroTransition` — exported today and
  called from nowhere, so any caller can currently write any state.
- Mock fallback refused on every RRO path. `BedrockService` answers a failed AWS call with
  a fabricated response; a made-up clinical classification shown to a clinician as real is
  the worst failure this system can produce.

**Done when**
- Malformed model output is a 502 and is not stored.
- Confidence below 0.7 stores the classification and does not transition.
- `intake → optimise` is refused with 422 `INVALID_TRANSITION`, and the classification is
  still stored.
- Bedrock unreachable returns 503, never a mock answer.
- Unsigned call → 401.

**Pairs with** Pushparaj's W7-5A–D and Vijay's VG-W7-2.

---

### W7-6 — Pre-consult summary backend — 4h

**Goal.** A clinician opens a case cold. The summary is generated once, stored against the
profile with the intake version that produced it, and read from storage afterwards — so
Week 8's workspace does not pay for the model every time somebody opens a page.

**Delivers**
- `POST /internal/ai/summary` (HMAC) and `GET /rro/:profileId/summary`.
- Stored with generated-at, prompt version and source intake version.
- `sufficientData: false` is stored as the refusal it is and never rendered as a finding.

**Done when**
- Opening a summary twice calls the model once.
- Empty intake yields the stored refusal, not an invented summary.
- A summary names the intake version it was derived from.

---

## 3. Pushparaj — AI — 35h

The plan budgets 33h for the classifier and 28h for the summary. 61h does not fit a 35h
week. The classifier is Week 8's dependency, so it lands whole; **24h of summary work moves
to Week 8**, where it joins the 8h summary panel.

### W7-5A — Classifier fixture corpus — 8h

**Goal.** You cannot tune a prompt against opinion. Before any tuning there has to be a set
of cases with an agreed right answer.

**Delivers** 40 intake fixtures spanning all four states, with expected state, expected
pillar priorities and expected refusals. Built with Vijay (VG-W7-1) so the expected answers
are clinical, not invented by engineering.

**Done when** the corpus runs against the `rules` provider and produces a baseline score
that the model has to beat.

---

### W7-5B — Bedrock classifier prompt tuning — 14h

**Goal.** `RRO_AI_PROVIDER` defaults to `rules` and Bedrock has never been called — the
prompt in `prompts.ts` is untested against a real model.

**Delivers** a tuned `CLASSIFIER_SYSTEM_PROMPT` scoring above the `rules` baseline on the
corpus. `RRO_PROMPT_VERSION` bumped per change and **never edited in place** — stored
classifications point at it.

**Done when** the model beats the deterministic baseline on the corpus, and every stored
result names the prompt version that produced it.

**Blocked by** W7-12 (Bedrock access).

---

### W7-5C — Confidence calibration — 6h

**Goal.** The 0.7 transition floor is a guess until somebody measures it. A model that is
confidently wrong at 0.8 moves patients incorrectly; one that is correctly unsure at 0.6
never moves anyone.

**Delivers** measured accuracy by confidence band across the corpus, and a recommended
floor with the evidence behind it.

**Done when** the floor is a number backed by data, signed off in VG-W7-2.

---

### W7-5D — Classifier guardrails and injection probes — 3h

**Goal.** Intake is free text a patient typed, and it reaches a model that decides clinical
state. The prompt fences it as data, and that fence needs testing.

**Delivers** probe set — diagnosis language, out-of-scope questions, instructions embedded
in symptom text, identifiers the model should refuse to ask for.

**Done when** no probe produces a diagnosis, a prescription or an identifier request, and
an instruction inside the intake block is ignored.

---

### W7-6A — Pre-consult summary prompt, first pass — 4h

**Goal.** Get red flags working, which is the part a clinician acts on first. Concerns,
missing data and suggested questions carry to Week 8.

**Done when** a red-flag fixture surfaces the flag with its severity, and an empty intake
returns the refusal rather than an invented finding.

---

## 4. Milan — DevOps — 16h

W7-9 (calendar invite, endpoint 10) is **not** a Week 7 card. It already exists on the board
as **M-W6-2**, sitting in Blocked because closing it means shipping booking-service to the
client repo, which is deliberately out of scope. Carrying the same deliverable twice would
put a card on Week 7 that Week 6 already owns.

Milan lands at 16h against a 20h allocation. The remaining 4h is deliberate slack on the
critical path — W7-12 is what the whole AI track waits on, and padding the week with a
made-up card to reach a number would be the opposite of useful.

### W7-12 — Bedrock model access and RRO provider enablement — 5h

**Goal.** The whole AI track is blocked without it. `AWS_ENDPOINT_URL` points at
LocalStack, no credentials are configured, and `RRO_AI_PROVIDER` therefore defaults to
`rules`.

**Delivers** IAM role, model access for the RRO model id, region confirmed, and
`RRO_AI_PROVIDER=bedrock` producing a real classification locally.

**Done when** a developer can run one classification end to end against Bedrock.

**This is the critical path — Monday, before anything else.**

---

### W7-13 — ai-content joins the E2E runner and CI — 5h

**Goal.** ai-content-service is not in `scripts/run-e2e.sh` today, so this week's three new
suites have no runner. Bun's `SO_REUSEPORT` also lets a second listener bind a port another
service already holds and silently split traffic, which the runner's `healthy_service`
check is what catches.

**Delivers** ai-content in the runner in dependency order after auth, with the health check
that names the expected service; the three new suites wired in; CI runs them.

**Done when** a clean checkout runs the full suite green, and a port collision fails loudly
instead of splitting traffic.

---

### W7-14 — Dev EC2 deploy and verification — 6h

**Goal.** Local green is not deployed green. The testing gate in root `CLAUDE.md` requires
infra-touching work to run on the dev EC2 before a card closes.

**Delivers** the Week 7 stack on `13.126.33.146`, E2E suites re-run against it, health
endpoints verified.

**Done when** every Week 7 endpoint answers on the dev host and the suites pass there.

---

## 5. Vijay — Architect — 14h

Paired, and each one gates work that would otherwise be redone.

### VG-W7-1 — RRO taxonomy clinical validation — 4h — with Pushparaj

**Goal.** Four states and five pillars are hard-coded across the classifier, the prompt and
the transition rules. Confirm they match the clinical model the clinic actually runs
**before** 40 fixtures are written against them.

**Done when** the taxonomy is confirmed or corrected in writing, before W7-5A starts.

---

### VG-W7-2 — Classifier acceptance criteria — 3h — with Vishal and Pushparaj

**Goal.** Decide what "good enough to move a patient's state" means as a number, agreed
before tuning rather than argued after it. Covers the confidence floor, acceptable
false-transition rate, and what the model must beat.

**Done when** the criteria are written down and W7-5C is measured against them.

---

### VG-W7-3 — Intake schema clinical review — 4h — with Vishal

**Goal.** The intake body is the input to every downstream clinical decision and it is
versioned forever. Fields wrong here are expensive later.

**Done when** the symptom, goal, condition, medication and pillar-priority shapes are
signed off before W7-3 ships.

---

### VG-W7-4 — Week 7 API contract and tenancy sign-off — 3h — with Vishal

**Goal.** Same gate as VG-W6-3. Every new endpoint reviewed for contract shape, and the
404-not-403 rule confirmed on every profile-scoped route.

**Done when** each Week 7 endpoint has a reviewed contract and a recorded tenancy verdict.

---

## 6. What does not fit, and where it goes

Named openly rather than dropped. The plan's Week 7 backend demand is 64h against 35h of
capacity, and its AI demand is 61h against 35h.

| Card | h | Moves to | Why it is the right thing to move |
|---|---|---|---|
| W7-7 Report upload + timeline | 8 | Week 8 | Week 8's workspace is the first consumer; nothing in Week 7 reads it |
| W7-8 Booking + order readiness | 5 | Week 8 | Only W7-7's provider-access check needs it, and that moves too |
| W7-10 R6 SSOT convergence | 10 | Week 8 | The plan's own §4 names it as the piece nothing depends on |
| W7-11 Gateway, Swagger, docs | 5 | Week 8 | Ships with the routes it exposes rather than ahead of them |
| W7-6 summary, remainder | 24 (AI) | Week 8 | Joins the 8h summary panel for a 34h AI week |
| D7 tables (`check_ins`, `adherence`) | 3 | Week 9 | Consumed in Week 9; created there instead |

Week 8's backend demand becomes **83h** as a result. At 35h/week that is 2.4 weeks of work
in one week, and it cascades: on current arithmetic the track finishes in **Week 13**, not
Week 12.

Three ways to close that gap, and it is a resourcing decision rather than a technical one:

1. **A second backend developer from Week 8.** 83h across two people is 42h each — still
   over, but one further week absorbs it and the track lands in Week 12.
2. **Cut Week 10's admin console (6h) and Week 11's load work.** Buys one week, costs pilot
   confidence.
3. **Accept Week 13.** Honest, and the client sees the same scope on a date that holds.

Recommended: option 1. The backend column has carried this whole track alone since Week 6
and has no slack anywhere in it.

---

## 7. Week 7 exit criteria

- Intake → classify → RRO state transition works end to end on real infrastructure.
- A Bedrock classification has been scored against a fixture corpus with an agreed expected
  answer, and the confidence floor is a measured number rather than a guess.
- Onboarding is profile-scoped, and another account reading a session gets 404.
- An illegal RRO transition is refused wherever it is attempted.
- No RRO path can return fabricated model output.
- A calendar invite reaches a real mail server and the delivery outcome is recorded.
- ai-content runs in the E2E runner and in CI.
- `bun run typecheck` 0 errors, `bun run lint` 0 errors, all suites green, Swagger clean,
  frontend docs updated for every endpoint shipped.
