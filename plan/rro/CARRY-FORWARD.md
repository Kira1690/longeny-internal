# Carry-Forward Register

**The one file to read before planning any week.** Everything decided, found or designed
but not yet built, in the order it has to happen. Updated 2026-09-04.

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
| A3 | **Bedrock model id is wrong for the region.** `BEDROCK_MODEL_ID_RRO` defaults to a model not in the ap-south-1 list. Bedrock access itself works. | Open — Milan (M-W7-1) | `internal-notes/aws/README.md` |
| A4 | **M-W6-2 calendar invite** cannot close without shipping booking-service to the client repo, which is out of client scope. | Open — a scope decision | Trello, Blocked list |

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

## B. Done in `longeny-internal`, not yet shipped

| # | What | State | Next step |
|---|---|---|---|
| B1 | **Seven API defects** — soft-deleted profiles still readable/editable/consentable/**contactable**; 500 on malformed uuid; optional `""` rejected; four broken Swagger examples; `consent_type` unenforced; **and the three internal HMAC routes that never had the status check at all** (see D7) | Fixed and committed in `longeny-internal`. typecheck 15/15, lint clean, `profiles-rro` 86/86 | Migrate to `BraveLabs/` under card **V-W7-7** |
| B2 | **Week 7 backend** — 12 endpoints, 7 tables | Complete and committed (2026-09-06, nine commits from `0eafab0`) | Migrate under the Week 7 cards |

---

## C. Deferred with a reason — do not rediscover these

| # | What | Why it was deferred | Where it goes |
|---|---|---|---|
| C1 | **R6** — ai-content's 112 TypeBox `t.*` usages across 14 route files converge on `@longeny/validators` | Mechanical, touches every legacy ai-content surface, week was over cap | Week 8, V-W7-3 remainder |
| C2 | **D2 query conversion** — progress / habits / goals still filter on `user_id`, not `profile_id`. Columns and middleware exist; the queries do not use them | Scheduled card, never the blocking one | Week 8 (was V-W7-5, "first to cut") |
| C3 | **SMS has no transport.** Every SMS notification records `failed` with that reason — deliberate and visible, but a dependent reachable only by phone is not reachable | No carrier chosen | Needs a product decision, not an engineering one |
| C4 | **481 `noExplicitAny` warnings**, mostly `({ body, store }: any)` in controllers | Not failing the build; the standard forbids *new* ones | Opportunistic |

---

## D. Facts that keep getting re-derived — stop re-deriving them

1. **The track ends Week 13, not Week 12**, on one backend developer. 203h remain after
   Week 7 at 35h/week. Week 8 alone is 83h against 35h — the worst overrun in the plan —
   and adding A1 or A2 makes it worse. Arithmetic and the three ways out:
   [capacity-weeks-07-12.md](./capacity-weeks-07-12.md).
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

## G. Week 7 verification — done 2026-09-06

Everything §G asked for, except the migration to the client repo, which was deliberately
not done: this pass was internal-repo only, by instruction.

| | Result |
|---|---|
| G1 Commit | 265 files in nine commits from `0eafab0`, plus two more for the fixes below. Working tree clean. |
| G2 `consent_type` | Now the `caregiver_consent_type` pg enum. Migration `0004` maps off-taxonomy rows rather than dropping them and aborts loudly on anything it cannot map — two live rows held `caregiver_access` and would have failed the generated cast. Verified: the column itself refuses an off-list value. |
| G3 Suites | **12/12 pass, 646 checks + 7 unit assertions, 0 failures**, on real Postgres, Redis and SMTP. Baseline was 606. |
| G4 Regression tests | Six sections added (29–34), all green. |
| G5 Migrate | **Not done — internal only this pass.** Still open under V-W7-7. |

### What the run found that §G did not know about

A seventh defect, and the reason it survived the first fix: **the internal HMAC routes never
pass through `assertOwnership`**, and three of them checked only that the profile row
existed. A deactivated profile stayed reachable through `notifyProfile`, `recordTransition`
and `getRroStateForService`. The first of those actually delivered mail to a removed person
— confirmed by reading mailpit, not by trusting the API's own answer.

All three now share `assertActiveProfileForService()`. See D7 and D8, and the new line in
the per-card checklist in [00-engineering-standards.md](./00-engineering-standards.md).

### Still open

- **Migrate Week 7's 12 endpoints to `BraveLabs/`** under the Week 7 cards. Scope-scan the
  diff first: no Claude reference, no `internal-notes/` content, no `plan/rro/` content,
  nothing outside the week's cards. This is the only part of V-W7-7 not done.
- The 44h overrun is **settled**: Week 7 stands as delivered, and D2 query conversion moved
  out to its own Week 8 card. A1 and A2 are **decided** — see section A.

---

## F. Where everything lives

| | |
|---|---|
| Week plans, capacity, open designs | `longeny-internal/plan/rro/` — internal only, never migrates to the client repo |
| Standards gate applied per card | [00-engineering-standards.md](./00-engineering-standards.md) |
| Scope source of truth | `prep/RRO_MVP_Gantt_Chart.xlsx`, `prep/RRO_MVP_Work_Plan.xlsx` (Week 8 row 13b is flagged PENDING) |
| Board | Trello `LONGENY MVP — 60-Day Sprint`, lists Week 6 / Week 7 / In Progress / In Review / Done / Blocked |
| Secrets, AWS, PEM | `internal-notes/`, `pemKey/` — outside both repos, committed to neither |
