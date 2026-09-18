# Carry-Forward Register

**The one file to read before planning any week.** Everything decided, found or designed
but not yet built, in the order it has to happen. Updated 2026-09-14.

If this disagrees with a week file, this is newer. If it disagrees with
`prep/RRO_MVP_Gantt_Chart.xlsx`, the XLS wins on scope and this wins on "what did we learn
since".

---

## A. Decided, and what is genuinely still open

**A1 and A2 were decided 2026-09-06.** They had been waiting on Vijay; the architecture
calls were made rather than left blocking Week 8. Both design docs now carry the answers
and the reasoning.

| # | What | Status | Written up |
|---|---|---|---|
| A1 | **Care team model.** One team per patient, one lead (partial unique index). Role lives on the membership. Profile-scoped, never account-scoped. A lead or admin may add; **membership grants no access until per-member consent exists**. Deactivating a profile ends every membership in the same transaction. | **DECIDED** — D-1…D-5 all answered | [care-team-model.md](./care-team-model.md) |
| A2 | **Verified consent by email.** Threshold 18 / DPDP, held in config with the jurisdiction written onto each row. `pending` is usable and labelled, but blocks AI analysis and every provider surface. Two reminders, expire at 14d, one manual re-send. | **DECIDED** — all four answered | [verified-consent-design.md](./verified-consent-design.md) |
| A3 | **Bedrock is unusable — and it is the client's to fix.** Account `836533914754` refuses every model invocation with `INVALID_PAYMENT_INSTRUMENT`. Everything on our side is done and proven (see D9, D10). **28h of paid work is idle**: M-W7-1, P-W7-2, P-W7-3, P-W7-4, all carrying a red *Client Action* label on the board. Nothing for the team to build. | **Blocked on the client's AWS billing** | `infrastructure/deploy/README.md` |
| A4 | **M-W6-2 calendar invite** — **RESOLVED 2026-09-10.** booking-service stays internal, so the card was descoped and archived. The invite service, ICS attachment, calendar channel and delivery logging all still work internally and need no rebuild if booking-service is ever brought into client scope. | **CLOSED** | Trello, archived |

### The consequence of A1+A2 that changes Week 8's shape

They are one piece of machinery, not two features. The care team's per-member consent (A1
D-4) is built on A2's `consent_request` table — same token, same expiry, same confirm and
decline endpoints, different copy. So the build order is fixed:

> **consent machinery → `care_team_member` + access resolver → Week 8 §8.1 and §8.2**

Built the other way round, the workspace queries an assignment that does not exist yet and
the team table grows its own bespoke consent. **Sequencing, not hours, is what would cost a
rebuild here.**

### Still needs a human — neither blocks the build

1. **Legal confirmation of 18 / DPDP** for this pilot's jurisdiction. The number is a
   config value and every row records the jurisdiction it was taken under, so changing it
   later is cheap. Needed before real patients, not before code.
2. **The consent email's wording.** It reaches an elderly person who was not expecting it,
   about their medical data. Ships behind a draft template; the draft does not go to a real
   person unread.
3. **The clinical shape of a team** — whether a coach without a clinical qualification may
   hold standing access to a diagnosis, what a lead is accountable for. `role` is an enum;
   adding a value is a migration. Blocks the pilot, not the schema.

---

## B. Shipped — Week 7, for the record

| # | What | State | Next step |
|---|---|---|---|
| B1 | **Seven API defects** — soft-deleted profiles readable/editable/consentable/**contactable**; 500 on malformed uuid; optional `""` rejected; four broken Swagger examples; `consent_type` unenforced; and the three internal HMAC routes that never had the status check (D7) | **Shipped to `BraveLabs/` 2026-09-10.** V-W7-7 is Done. | Done |
| B2 | **Week 7 backend** — 12 endpoints, 7 tables | **Shipped to `BraveLabs/` 2026-09-10** (`f244c55..0627e12`, six commits). Client typecheck 13/13, lint 0 errors, all four services boot. `docs/18-intake-and-rro-ai.md` written for frontend engineers. | Done |

---

## C. Deferred with a reason — do not rediscover these

| # | What | Why it was deferred | Where it goes |
|---|---|---|---|
| C1 | **R6** — ai-content's 112 TypeBox `t.*` usages across 14 route files converge on `@longeny/validators` | Mechanical, touches every legacy ai-content surface, week was over cap | Week 8, V-W7-3 remainder |
| C2 | **D2 query conversion** — progress / habits / goals still filter on `user_id`, not `profile_id`. Columns and middleware exist; the queries do not use them | Displaced from Week 7, then displaced again by the Week 8 scope change | **Still unscheduled.** Written up in [week-08-workspace.md](./week-08-workspace.md) §8.8. Not on the board. |
| C3 | **SMS has no transport.** Every SMS notification records `failed` with that reason — deliberate and visible, but a dependent reachable only by phone is not reachable | No carrier chosen | Needs a product decision, not an engineering one |
| C4 | **481 `noExplicitAny` warnings**, mostly `({ body, store }: any)` in controllers | Not failing the build; the standard forbids *new* ones | Opportunistic |

---

## D. Facts that keep getting re-derived — stop re-deriving them

1. **The track ends around Week 14–15, not Week 12 and no longer Week 13.** ~183h of
   backend remain after Week 8 at 35h/week. The Week 13 figure assumed a second backend
   developer from Week 8; **that is not happening**, so it is gone. Consent (27h) and the
   care team (23h) are 50h that were never in the XLS and are both prerequisites for the
   clinician workspace. Current arithmetic and the two remaining levers — cut scope, or
   accept the date — are in
   [capacity-weeks-07-12.md §0](./capacity-weeks-07-12.md). **Do not quote Week 12 or
   Week 13.**
2. **6h/day and 35h/week only reconcile on a six-day week.** 5 × 6 = 30h. Every schedule
   here assumes Mon–Fri 6h plus Sat 5h.
3. **The dev server has no git and no rollback.** `~/longeny` is a file copy. Its schema
   was built by `db:push`, so migrations generated against an empty database would have
   failed mid-run — that is why the databases were rebuilt on 2026-09-03. Folded into
   **M-W7-3**.
4. **booking-service and payment-service have never been deployed** to the dev box, which
   is why gateway `/health` has read `degraded` for months. A real outage would look
   identical. Also M-W7-3.
5. **Two consent systems, different questions.** Caregiver consent (4 types, on a profile,
   *may I manage this person's care?*) is not account consent (7 types, on a login,
   enforced by a pg enum, *what did this account holder agree to?*).
6. **AWS is project-scoped**: `source internal-notes/aws/env.sh`. The machine's global
   `~/.aws` default is a **different account** and is not ours.
7. **The internal HMAC routes do not pass through `assertOwnership`.** There is no account
   to check them against, so each one re-stated the profile lookup by hand — and three of
   the four checked only that the row *existed*, never that it was active. A deactivated
   profile therefore stayed reachable through `notifyProfile` (a real email went to a
   removed person), `recordTransition` and `getRroStateForService`. They now share one
   `assertActiveProfileForService` helper. **Any new internal route must call it**; the
   ownership guard will not cover you there.
8. **A mock would have hidden it.** The delivery check asks mailpit, not the API response.
   A fake transport reports "not delivered" whether or not the message left the building —
   which is why `prep/testing/README.md` requires real Postgres, Redis and SMTP.
9. **Bedrock in ap-south-1 needs the `apac.` inference-profile prefix.** The bare model id
   raises `ValidationException: on-demand throughput isn't supported`. `apac.` rather than
   `global.` is a data-residency choice, not a style one: an inference profile decides
   where the request is served, and this is patient health data under DPDP. Newer models on
   this account are `global.`-only and not access-enabled.
10. **An explicit AWS credential beats an IAM role, including a placeholder one.**
   `AWS_ACCESS_KEY_ID` defaults to the literal `'test'` for LocalStack, and the Bedrock
   provider passed it unconditionally — so the instance role we attached was silently
   ignored and Bedrock answered `UnrecognizedClientException`. Only pass credentials when
   they are real; otherwise let the SDK's default chain find the role.
11. **Roles and permissions are seeded, not migrated — and the E2E suites cannot catch a
   gap.** The suites mint their own tokens with the permission list hard-coded, so they
   never read the role map from the database. `intake:write` existed in the seed and not in
   the deployed database, and the live API answered 403 to a correctly built request while
   646 local checks stayed green. The seed now runs on every deploy.
12. **A presigned S3 upload link from SDK ≥ 3.729 cannot work unless checksums are
   turned down.** The client bakes `x-amz-checksum-crc32` of the *empty* body into the
   link, so S3 rejects every real file sent to it. Every report upload link ai-content
   ever issued was dead; no test noticed because none sent bytes. Fixed in ai-content with
   `requestChecksumCalculation: 'WHEN_REQUIRED'` (M-W8-2). **user-provider's provider
   onboarding presigns the same way and is not yet fixed** — out of Week 8's scope,
   one line, needs a card.
13. **The dev box had no reports bucket at all.** Its `.env` sets no `S3_*` and no
   `AWS_REGION`, so ai-content signed links for `longeny-documents` (LocalStack's name —
   doesn't exist on our account, and bucket names are global) in `us-east-1` with the
   placeholder key `test`. ai-content now refuses to boot in production on the LocalStack
   bucket name, and uses the instance role instead of the placeholder key.
14. **S3 enforces upload size and type only if both are signed headers.** The SDK signs
   `content-length` by default but not `content-type`. Both are now signed; LocalStack
   with `S3_SKIP_SIGNATURE_VALIDATION=0` proves S3 refuses a mismatch (its default skips
   signature checks and would pass that test for the wrong reason).

---

## E. The order that matters

Sequencing, not hours, is what will cost a rebuild:

1. **Build A2's consent machinery before A1's team table, and both before Week 8 §8.1/§8.2.**
   The workspace depends on an access resolver that depends on membership that depends on
   consent. Any other order writes something twice.
2. **Migrate B1 to the client repo** before the client sees more of the surface.
3. **Put the Week 8 capacity trade in front of the client**, not into a developer's week.
   110h against 35h is a resourcing decision, and it is now a decision about *sequence*
   rather than *whether* — the workspace cards cannot be built without A2.

---

## G. Where things stand — 2026-09-14

### Week 7 — closed

| | |
|---|---|
| Built, tested, shipped | 12 endpoints, 7 tables. 12/12 suites, 646 checks + 7 unit assertions, 0 failures, on real Postgres, Redis and SMTP. |
| Client repo | `f244c55..158284a`, pushed. typecheck 13/13, lint 0 errors. `docs/18-intake-and-rro-ai.md` written for frontend engineers. |
| Deployed | Live on `13.126.33.146:4001` and verified there — intake, classification, summary, report timeline, RRO state, cross-account 404s. |
| Deploys | Now `git push production main`, with migrations, role seeding, health gate and `deploy-rollback`. Scripts in `infrastructure/deploy/`. |

**Three defects survived 646 green local checks and only appeared on the deployed box.**
They are D11 and the two below it; the lesson is that local green is not evidence about a
server.

**Not done and honest about it:** the migration was not file-by-file. Whole service
directories were rsynced, so 8 files outside Week 7 scope went across (admin ×3,
progress ×3, seed-providers ×2). Two one-off internal repair scripts went with them and
were removed again. **Open question for the user: leave the 8, or strip them back.**

### Week 8 — reports, benchmarks and scoring

Scope reassigned by the client-side lead on 2026-09-14, replacing the clinician workspace.
Plan: [week-08-reports-benchmarks-scoring.md](./week-08-reports-benchmarks-scoring.md).
Board: 20 cards, 97h active, 28h blocked on the client.

The chain being built: `report (file) → readings → benchmark → score → advice`.

Two things to hold on to:

- **VG-W8-1 blocks 19h.** Reference ranges are a hard dependency, not paperwork — three
  backend cards have nothing to compare a value against without them.
- **A score never moves a patient between care stages on its own.** Easy to hold while the
  input was intake prose; much harder now the input is a lab panel and the output feels
  objective. V-W8-6 asserts it with a test; VG-W8-2 asks for it in writing.

### Deferred again, and the order still binds

consent (27h) → care team (23h) → queue + workspace (45h). Nothing in Week 8 advances that
chain; it simply does not break it. Built out of order, the workspace gets written twice.

---

## F. Where everything lives

| | |
|---|---|
| Week plans, capacity, open designs | `longeny-internal/plan/rro/` — internal only, never migrates to the client repo |
| Standards gate applied per card | [00-engineering-standards.md](./00-engineering-standards.md) |
| Scope source of truth | `prep/RRO_MVP_Gantt_Chart.xlsx`, `prep/RRO_MVP_Work_Plan.xlsx` (Week 8 row 13b is flagged PENDING) |
| Board | Trello `LONGENY MVP — 60-Day Sprint`, lists Week 6 / Week 7 / In Progress / In Review / Done / Blocked. **The board only ever holds the current week.** Future-week work lives in these plan files and in the XLS until that week is planned — do not create a list or cards ahead of it |
| Secrets, AWS, PEM | `internal-notes/`, `pemKey/` — outside both repos, committed to neither |
