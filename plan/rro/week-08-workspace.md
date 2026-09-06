# Week 8 — Clinician Workspace

> **Unblocked 2026-09-06.** §8.1 and §8.2 are written against "profiles assigned to the
> calling provider", and no assignment existed in any schema — provider access was derived
> from a booking and nothing else, which cannot carry a care team. The model is now decided:
> [care-team-model.md](./care-team-model.md), all five decisions answered.
>
> **Read "assigned" and "linked" below as: an active `care_team_member` row, or an active
> booking.** One resolver, both bases, the way `assertOwnership` already works for profiles.
>
> **Order matters.** The consent machinery in
> [verified-consent-design.md](./verified-consent-design.md) is what the team table's
> per-member consent is built on (D-4), and membership grants no access until that consent
> exists. Build it in this order or the workspace is written twice:
>
> 1. consent machinery (§8.7) → 2. `care_team_member` + access resolver → 3. §8.1 and §8.2
>
> This ordering, not the hours, is the thing that will cost a rebuild if ignored.

Plan rows 10–13. Endpoints 18–23. DB D8 table lands here for Week 10 use.
Depends on: Week 7 (summary, intake, RRO state).

## 8.1 Provider patient queue — 20h — Vishal — endpoint 18
- `GET /workspace/queue` — profiles assigned to the calling provider, grouped by RRO state,
  with next-goal and last-activity. Filter, sort, paginate.
- Authorization: a provider sees only profiles linked to them; the account owner is not a
  provider and gets 403.
- Test: provider A cannot see provider B's queue; unassigned profile appears in neither.

## 8.2 Patient workspace — 25h — Vishal — endpoints 19, 21, 22, 23
- `GET /workspace/patients/:profileId` — case detail: profile, intake, RRO state and
  history, reports timeline, notes, tasks.
- `POST /workspace/patients/:profileId/notes` — clinician note, append-only, authored,
  timestamped.
- `GET|POST /workspace/patients/:profileId/tasks` — task list and creation.
- Tables: `clinician_notes`, `care_tasks` (both profile_id-scoped).
- Test: every route rejects a provider with no link to the profile; notes cannot be edited
  or deleted, only appended.

## 8.3 AI summary panel — 6h BE + 8h AI — endpoint 20
- `GET /workspace/patients/:profileId/summary` returns the stored Week-7 summary, with an
  explicit regenerate action rather than an implicit model call on every open.
- Test: opening the workspace twice does not call the model twice.

## 8.4 Gateway re-open — 6h — Milan
- Gateway is deny-by-default. Open `/workspace/*` and the documents routes deliberately,
  provider-role-gated.
- Test: a patient token on `/workspace/queue` returns 403 at the gateway, not at the
  service.

## 8.5 Outcomes table — 4h — Vishal (D8)
Create `outcomes` / `metrics` (profile_id, metric_type, value, measured_at) now so Weeks 9
and 10 write into a stable shape.

## 8.6 R8+R9 — config SSOT and payment guards — 6h — Vishal/Milan
- 25 direct `Bun.env` / `process.env` reads outside `packages/config` move behind validated
  config. A missing variable must fail at boot, not at the first request.
- `payment-service` has no role guard anywhere (`requireRole` count = 0). Add role and
  permission guards to every route, plus the ownership check that the payer owns the
  booking's account.
- Test: service refuses to boot with a missing required variable; a patient token cannot
  read another account's payment.

## 8.7 Verified consent by email — 27h BE + 4h Vijay + 3h Milan — NOT YET SCHEDULED

Consent is currently recorded by the account holder on the dependent's behalf
(`granted_by` is always the caller), so the system holds a caregiver's *claim* rather
than the patient's answer. Design, cost and the open legal question:
[verified-consent-design.md](./verified-consent-design.md).

**All four open decisions are now answered** (threshold 18/DPDP as config, `pending` usable
but blocked for AI and provider surfaces, two reminders then expire, wording drafted).
Two items are left to a human — legal confirmation of the threshold and the email copy —
and neither blocks the build.

It is also no longer a standalone 27h. The care-team model's per-member consent (D-4) is
built on this same `consent_request` machinery, so this work is a **prerequisite for §8.1
and §8.2**, not an optional extra beside them. It moved from "nice to have" to "first
thing in the week".

Adding it makes Week 8's backend demand 110h against 35h of capacity. That is the scope
decision to put in front of the client — and it is now a decision about *sequence and
resourcing*, not about whether to do it, because the workspace cards depend on it.

## 8.8 D2 — scope progress, habits and goals to profile_id — 6h — Vishal

Carried in from Week 7, where it was displaced when V-W7-7 grew from 9h to 12h. Not new
work found late: a known gap, scheduled, then cut when the defect fixes took its hours.
Tracked as C2 in [CARRY-FORWARD.md](./CARRY-FORWARD.md).

**The gap.** `progress_entries`, `habits`, `habit_checkins` and `goals` all gained a
`profile_id` column in Week 6, and the profile-context middleware resolves the active
profile on every request. **The queries still filter on `user_id`.** Column and middleware
exist; nothing reads them.

So tenancy is half applied on those four tables. A family account with a father and a
mother sees one merged set of habits and goals, because the filter is still the account,
not the person. Not a cross-account leak — `user_id` still scopes to the owner — but within
an account the profiles are not separated, which is the entire point of the model built in
Weeks 6 and 7.

**Scope**
- Convert every read and write on those four tables to filter and insert on `profile_id`,
  taken from the request's profile context.
- Legacy rows carry `profile_id = NULL`, meaning "the account owner's own record". Backfill
  to the account's self profile rather than leaving two meanings of NULL in one column.
- Any route with no profile context now needs one — check `remote-profile-context.ts`
  covers each.

**Done when**
- Two profiles under one account keep entirely separate habits, goals and progress, with a
  test that writes on both and asserts neither sees the other's.
- No query on those four tables filters on `user_id` — grep is part of the review.
- The backfill leaves no `profile_id IS NULL` row on any of the four.
- A deactivated profile's rows are unreachable, consistent with D7.
- typecheck 0 · lint clean · full E2E green on real infrastructure.

## Week 8 exit criteria
- A provider can open a real profile, read intake + RRO state + summary, write a note and a
  task, all through the gateway.
- Cross-provider and patient-role access blocked with tests.
- Every workspace route carries `requirePermission` and a service-layer assignment check —
  role `provider` alone never grants access to a specific patient.
- A provider with a membership row but no patient consent sees **nothing**, with a test.
- Deactivating a profile ends every membership in the same transaction, with a test that a
  removed patient disappears from the provider's queue.
- Config comes from `packages/config` everywhere; payment routes are guarded.
