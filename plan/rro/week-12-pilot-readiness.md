# Week 12 — Pilot Readiness + Handover

Dates: **Mon 2026-10-12 → Sat 2026-10-17**.

Week 12 exists because Weeks 8 to 11 carry 163h of backend work against 140h of capacity.
The arithmetic is in [capacity-weeks-07-12.md](./capacity-weeks-07-12.md). 23h of that is
the accumulated tail; 12h is Week 12's own work.

This is the last week of the track. Nothing new is designed here.

---

## 12.1 Backend tail from Weeks 8–11 — 23h — Vishal

Whatever Weeks 8 to 11 could not absorb. On current projection that is the back half of
the reporting endpoints and the family-flow suites. The specific contents are set at the
Week 11 review, not now — pretending to know them eleven weeks out would be planning
theatre.

## 12.2 Security and RBAC verification pass — 8h — Vishal

Carried from [Week 11 §11.3b](./week-11-integration-qa.md). Run
[00-engineering-standards.md](./00-engineering-standards.md) as a checklist against the
finished surface:

- Every route enumerated with its guard chain. A route with no ownership check is a bug,
  not a finding.
- Audit coverage: every PHI read and write produces a row, denials included.
- GDPR: a profile can be exported and erased, and every RRO table added in Weeks 6–11
  appears in both paths.
- Response scan: no encrypted column, no hash, no internal id in any response body.
- Secret scan across both repos.

## 12.3 QA, load and docs — 6h — Vishal

- A realistic dataset — hundreds of accounts, thousands of profiles — loaded and the
  Week 10 indexes measured against it. The dashboard's 300ms p95 is a claim until this
  runs.
- Frontend-facing docs complete for every endpoint shipped in Weeks 7–11.

## 12.4 Final migration to `BraveLabs/` — 10h — Vishal

The last batch of verified Trello cards copied to the client repo, typechecked, linted and
pushed. Scope scan for internal references before anything moves.

## 12.5 AI eval in CI + final tuning — 12h — Pushparaj

- The eval harness from Week 11 runs on every build; a regression fails it.
- Final prompt tuning against the eval scores, with `RRO_PROMPT_VERSION` bumped per change.
- The `rules` provider's scores recorded alongside the model's as the baseline the model
  must beat.

## 12.6 Production deploy + runbook — 12h — Milan

- Full stack to production infrastructure.
- Monitoring and alerting on the paths that matter: model failures, HMAC rejections, audit
  write failures, rate-limit trips.
- A runbook someone other than Milan can follow at 2am.

## 12.7 Client handover — 8h — Vijay, with Vishal

- Pilot readiness sign-off against the exit criteria below.
- Demo of the whole surface, self and parent profiles both.
- Handover of the API documentation to whoever builds the frontend.

---

## Week 12 exit criteria

- Every Trello card in Weeks 6–12 is Done and its code is in `BraveLabs/`.
- The security checklist has been run route by route, and every route has an ownership
  check.
- GDPR export and erase cover every table added across the track.
- AI evals run in CI and the model beats the deterministic baseline.
- The stack runs in production with monitoring and a runbook.
- A frontend engineer who never saw the backend can build against the docs.
