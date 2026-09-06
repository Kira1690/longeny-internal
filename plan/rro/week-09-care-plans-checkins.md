# Week 9 — Care Plans + Check-ins

Plan rows 14–16. Endpoints 24–29. DB D6, D7.

## 9.1 Document builder — 12h BE + 12h AI — Vishal/Pushparaj
- Prescription / nutrition / training drafts generated from the care plan and profile.
- Every generated document is a **draft** until a clinician approves it; drafts are never
  visible to the patient.
- Test: a draft is not returned by any patient-facing route.

## 9.2 Care plans + versioning — 12h — Vishal — endpoints 24–27
- `POST /care-plans` (draft), `GET /care-plans/:id`, `PUT /care-plans/:id` (creates a new
  version, never mutates), `POST /care-plans/:id/approve`.
- Tables `care_plans`, `care_plan_versions` (profile_id, version, status, approved_by,
  approved_at).
- Test: editing an approved plan produces version n+1 in draft; the approved version stays
  byte-identical and readable.

## 9.3 Check-ins + adherence — 16h — Vishal — endpoints 28, 29
- `POST /check-ins` weekly submission, `GET /check-ins` list by profile.
- Adherence computed from tasks completed vs assigned in the window; stored in `outcomes`.
- Reminder hook: a missed check-in for a parent profile routes through
  `POST /internal/notify/profile`.
- Test: adherence numbers for two profiles under one account never mix.

## 9.4 R10 — rate limits on cost- and abuse-sensitive routes — 4h — Vishal
Only auth routes and the gateway global are limited today.

- Per-account limits on profile creation, intake submission, check-in submission.
- Per-account and per-provider limits on AI classify, summary regeneration and document
  generation — these cost money per call.
- Test: limit trips at the configured threshold and returns 429 with a retry hint.

## Week 9 exit criteria
- A clinician can draft, version and approve a care plan for a parent profile.
- A week of check-ins produces an adherence number backed by stored rows.
- Approval is permission-gated, not role-gated: only a clinician with `care_plan:approve`
  on an assigned profile can approve, and the approval writes an audit row.
- AI generation routes are rate limited.
