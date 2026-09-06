# Week 8 — Clinician Workspace

> **Blocked on a model decision.** §8.1 and §8.2 below are written against "profiles
> assigned to the calling provider" and "a provider sees only profiles linked to them".
> **No assignment or link exists in any schema.** Provider access today is derived from a
> booking and nothing else, which cannot carry a care team. See
> [care-team-model.md](./care-team-model.md) — D-1 and D-2 need Vijay before these two
> cards (45h of the week) can be built.

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

Adding it makes Week 8's backend demand 110h against 35h of capacity. It needs a scope
decision before it goes on the board, not after.

## Week 8 exit criteria
- A provider can open a real profile, read intake + RRO state + summary, write a note and a
  task, all through the gateway.
- Cross-provider and patient-role access blocked with tests.
- Every workspace route carries `requirePermission` and a service-layer assignment check —
  role `provider` alone never grants access to a specific patient.
- Config comes from `packages/config` everywhere; payment routes are guarded.
