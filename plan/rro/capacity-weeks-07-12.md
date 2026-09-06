# Capacity — Weeks 7 to 12 (Week 13 at current resourcing)

Why this track needs six more weeks, and what each person is doing in each of them.

Caps: **6h/day, 35h/week** per person; Milan is allocated 20h in Week 7 and less
thereafter, because DevOps work on this track is bursty rather than continuous.

---

## 1. Why Week 12 exists

The backend is the binding constraint, and it has been since the plan sheet said so.
Adding up the backend hours the week plans themselves specify:

| Week | Backend demand | Source |
|---|---|---|
| 8 | 55h | queue 20 + workspace 25 + summary BE 6 + outcomes 4 |
| 9 | 44h | doc builder BE 12 + care plans 12 + check-ins 16 + R10 4 |
| 10 | 40h | dashboard 12 + reporting BE 22 + admin console 6 |
| 11 | 24h | family flows 10 + security pass 8 + QA 6 |
| **Total** | **163h** | |

163h of backend work against one backend developer at 35h/week is **4.7 weeks**. Weeks 8
through 11 provide four. The shortfall is not a scheduling preference — it is 23h of work
with nowhere to sit, and it lands in Week 12.

W8.6 (R8 + R9 — config SSOT and payment guards) is already closed and carries 0h; it is
excluded from the demand above. The plan sheet's own capacity note reaches the same
conclusion from the other direction: *"Realistic: Weeks 6–12 (~6–7 weeks) incl. reporting."*

### How the overflow moves

Week 7 itself cannot absorb its own plan: 64h of backend demand against 35h of capacity,
so 28h leaves Week 7 before Week 8 has started
(see [week-07-schedule.md §6](./week-07-schedule.md)).

| Week | Carried in | New demand | Capacity | Carried out |
|---|---|---|---|---|
| 8 | 28h | 55h | 35h | 48h |
| 9 | 48h | 44h | 35h | 57h |
| 10 | 57h | 40h | 35h | 62h |
| 11 | 62h | 24h | 35h | 51h |
| 12 | 51h | 12h | 35h | 28h |
| 13 | 28h | 0h | 35h | **0h** |

**With one backend developer this track finishes in Week 13, not Week 12.** That is the
arithmetic, and it does not improve by wishing at it. 203h of backend work remains after
Week 7 and one person at 35h/week takes 5.8 weeks to clear it.

### Getting to Week 12

| Option | Effect | Cost |
|---|---|---|
| **Second backend developer from Week 8** | 191h across two people; Weeks 8–9 clear the backlog and the track lands in **Week 12** | One more head for five weeks |
| Cut Week 10's admin console (6h) and Week 11's load testing (6h) | Saves 12h — under half of one week | Pilot goes out unmeasured under load |
| Accept Week 13 | Same scope, a date that holds | One week later to the client |

Recommended: the second developer. The backend column has carried this track alone since
Week 6 and has no slack in any week. Cutting load testing before a clinical pilot is the
worst of the three.

The tables in §2 and §3 below assume **one** backend developer and therefore show the
Week 12 target as the plan of record, with the Week 13 tail called out where it falls.

## 2. The six-week schedule

| Week | Dates | Theme | Vishal | Pushparaj | Milan | Vijay | Total |
|---|---|---|---|---|---|---|---|
| 7 | Sep 7–12 | Profile resolution, intake, AI core | 35h | 35h | 16h | 14h | 100h |
| 8 | Sep 14–19 | Clinician workspace | 35h | 34h | 6h | 6h | 81h |
| 9 | Sep 21–26 | Care plans + check-ins | 35h | 12h | 6h | 4h | 57h |
| 10 | Sep 28–Oct 3 | Dashboards + reporting | 35h | 12h | 6h | 4h | 57h |
| 11 | Oct 5–10 | Integration, AI eval, hardening | 35h | 16h | 8h | 4h | 63h |
| 12 | Oct 12–17 | Pilot readiness + handover | 35h | 12h | 12h | 8h | 67h |
| **Total** | | | **210h** | **121h** | **54h** | **40h** | **425h** |

Every person is at or under cap in every week.

The AI total of 121h sits against the plan sheet's ~126h. The difference is Week 11's eval
harness, which the sheet costs at 12h and which this schedule splits across Weeks 10 and 11
so the fixtures written in Week 7 get reused rather than rebuilt.

---

## 3. What each person does, week by week

### Vishal — Backend — 210h

| Week | Work | h |
|---|---|---|
| 7 | Profile resolution (8), D6 tables (5), intake API (8), onboarding scoping (6), classifier BE (4), summary BE (4) | 35 |
| 8 | Carried from W7: reports timeline (8), booking readiness (5), R6 convergence (10), gateway + Swagger + docs (5); provider queue started (7) | 35 |
| 9 | Patient workspace part 2 (14), care plans + versioning (12), R10 rate limits (4), check-ins start (5) | 35 |
| 10 | Check-ins + adherence finish (11), document builder backend (12), user dashboard API (12) | 35 |
| 11 | Outcomes + reporting endpoints (22), admin console (6), E2E family flows (7) | 35 |
| 12 | Security + RBAC verification pass (8), family flows finish (3), QA and load (6), docs (8), final client migration (10) | 35 |

### Pushparaj — AI — 121h

| Week | Work | h |
|---|---|---|
| 7 | Fixture corpus, Bedrock classifier tuning, confidence calibration, summary first pass, guardrail probes | 35 |
| 8 | Pre-consult summary carried from W7 (26), AI summary panel (8) | 34 |
| 9 | Document builder — prescription, nutrition and training draft generation | 12 |
| 10 | Reporting AI (6), eval harness fixtures started (6) | 12 |
| 11 | Eval harness + guardrail suite in CI (12), family-flow AI checks (4) | 16 |
| 12 | Final prompt tuning against the eval scores, evals wired into the build | 12 |

### Milan — DevOps — 54h

| Week | Work | h |
|---|---|---|
| 7 | Bedrock access (5), ai-content into E2E runner + CI (5), dev EC2 deploy (6) | 16 |
| 8 | Gateway re-open for `/workspace/*`, provider-role-gated at the edge | 6 |
| 9 | CI pipeline for the new suites, staging refresh | 6 |
| 10 | Index and query performance on seeded data, monitoring | 6 |
| 11 | Full-stack dev EC2 deploy, family flows re-run against it | 8 |
| 12 | Production deploy, monitoring, alerting, runbook | 12 |

### Vijay — Architect / Manager — 40h

| Week | Work | h |
|---|---|---|
| 7 | RRO taxonomy validation (4), classifier acceptance criteria (3), intake schema review (4), API contract + tenancy sign-off (3) | 14 |
| 8 | Workspace UX and clinician flow review with Vishal | 6 |
| 9 | Care plan approval model — who may approve what, clinically | 4 |
| 10 | Reporting metrics — which numbers the client is actually buying | 4 |
| 11 | Eval acceptance review with Pushparaj | 4 |
| 12 | Client handover, pilot readiness sign-off, demo | 8 |

---

## 4. Standing risks against this schedule

1. **One backend developer carries 210h.** Any sick week moves the finish date directly.
   There is no slack anywhere in the backend column.
2. **The AI track has no model access yet.** Week 7 assumes Bedrock credentials land on the
   Monday. Every day they slip is a day of Pushparaj's tuning that moves to Week 8, which is
   already at 34h.
3. **Week 8's demand is 55h against a 35h capacity** — the largest single-week overrun in
   the plan. If the patient workspace runs long, the carry into Week 9 grows and every
   subsequent week absorbs it.
4. **Nothing has been load tested.** Week 10's dashboard has a p95 target of 300ms and the
   indexes to support it, but the first realistic dataset does not exist until Week 12.
5. **Frontend is out of scope for this team.** "Done" means APIs built, tested, deployed and
   documented. If a frontend appears mid-track, none of these numbers hold.
