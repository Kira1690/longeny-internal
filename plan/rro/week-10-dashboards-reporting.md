# Week 10 — Dashboards + Reporting

Plan rows 17–19. Endpoints 30–32.

## 10.1 User dashboard API — 12h — Vishal
- One call per profile returning: current RRO state and next goal, active care plan,
  open tasks, recent reports, next booking, last check-in.
- Must be a single aggregated response — the frontend should not need six calls per profile
  switch.
- Test: response for father profile contains no mother-profile row; p95 under 300ms on
  seeded data (this is what the 6.4 indexes are for).

## 10.2 Outcomes + reporting — 22h BE + 6h AI — endpoints 30–32
- `GET /outcomes/:profileId` — RRO transitions plus biomarker/symptom trends over time.
- `GET /reports/adherence` — adherence across profiles a provider is responsible for.
- `GET /reports/rro-transitions` — how many profiles moved intake→reverse→restore→optimise,
  over a date range.
- This is the moat data: it only exists because state transitions were recorded from
  Week 6 onward.
- Test: transition counts reconcile against raw `rro_transition` rows.

## 10.3 Admin console — pilot ops — 6h — Vishal
- Extend existing admin routes with profile awareness: list accounts with their profile
  counts, view a profile's RRO history, force a state correction with an audit row.
- Test: an admin correction writes an audit row naming the admin.

## Week 10 exit criteria
- Dashboard returns a complete profile picture in one call.
- Reporting numbers reconcile with the underlying tables.
