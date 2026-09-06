# Week 11 — Integration, AI Eval, Hardening

Plan rows 20–22.

## 11.1 End-to-end family flows — 10h BE + 4h AI — Vishal/Pushparaj
Three scripted flows on real infrastructure, no mocks:
1. **Self** — register → onboard → intake → classify → book → report → check-in → dashboard.
2. **Parent** — account owner creates a father profile, consents on his behalf, onboards
   him, books for him, receives his reminders on his own phone/email, reads his dashboard.
3. **Family** — three profiles active at once; switch context repeatedly and assert no
   cross-contamination at any step.

## 11.2 Cross-tenant isolation suite — included above — Vishal
Today the only isolation tests are in the profiles suite. Every profile-scoped endpoint
added in Weeks 7–10 needs a matching "other account gets 404" case. This suite is the
single most important safety net in the whole track — it is what makes the tenancy claim
true rather than intended.

## 11.3 AI eval harness + guardrails — 12h — Pushparaj
- Fixture set with expected classifier states and expected summary flags.
- Guardrail tests: no diagnosis language, refusal on out-of-scope questions, behaviour on
  low confidence, behaviour on malformed model output.
- Run in CI; a regression fails the build.

## 11.3b Security and RBAC verification pass — 8h — Vishal
Run the standards file as a checklist against the finished surface, not as a spot check:
- Every route enumerated with its guard chain; any route with no ownership check is a bug.
- Audit coverage: every PHI read and write produces a row, denials included.
- GDPR: a profile can be exported and erased, and every RRO table added in Weeks 6–10
  appears in both paths.
- Response scan: no encrypted column, no hash, no internal id leaks in any response body.
- Secret scan across both repos before anything migrates to `BraveLabs/`.

## 11.4 QA, hardening, docs — 6h BE + 8h DevOps — Vishal/Milan
- Load a realistic dataset; confirm the indexes from 6.4 hold up.
- Deploy the full stack to dev EC2 and re-run flows 1–3 against it.
- Frontend-facing docs updated for every endpoint shipped in Weeks 7–10, in the same
  format as `docs/07-profiles-rro-api.md` and `docs/08-profiles-rro-api-testing.md`.

## Week 11 exit criteria
- All three family flows pass locally and on dev EC2.
- Every profile-scoped endpoint has a cross-tenant negative test.
- AI evals run in CI.
- Docs complete enough for a frontend engineer who never saw the backend.
- Route-by-route guard table complete, with no route lacking an ownership check.
- GDPR export and erase cover every RRO table.
