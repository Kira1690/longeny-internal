# 06 · Onboarding Persistence & Name-Aware Greeting (Frontend Integration)

What changed for frontend engineers as of 2026-07-17. Two things: (1) AI onboarding data is now
**persisted to the patient's profile**, and (2) Aria **greets the patient by name** from their account.

All endpoints below go through the gateway at `/api/v1/...` with the usual `Authorization: Bearer <jwt>`.

---

## 1. Onboarding now personalises the greeting

`POST /api/v1/ai/onboarding/start` is unchanged in shape (no body needed) — but the returned
`first_question` now greets the authenticated patient **by their account name** and asks who the visit
is for, instead of asking for the name.

**Response 200**
```json
{
  "success": true,
  "data": {
    "session_id": "d929c1f2-...",
    "first_question": "Hi Sarah! I'm Aria, and I'm here to help you get started with your visit today. What's bringing you in, and is this appointment for you or someone else?"
  }
}
```

Notes for the UI:
- The patient no longer needs to type their name. Their first message should answer the complaint
  and/or who the visit is for (e.g. *"It's for me — bad migraines for a week"* or *"for my son"*).
- If the account name can't be resolved (rare), Aria falls back to asking for the name — the UI needs
  no special handling either way.
- For **someone else** (a child/parent), the account holder is treated as the caregiver; Aria collects
  that person's details.

Everything else in the onboarding loop (`/step` SSE stream, `/matching/match`) is unchanged.

---

## 2. `GET /api/v1/users/me` now returns the onboarding health data

After a patient finishes onboarding **and** runs a match, their intake is written to their durable
profile. The profile endpoint returns two new fields (both `null` until an onboarding+match completes):

```jsonc
{
  "success": true,
  "data": {
    "id": "...", "email": "...", "first_name": "Sarah", "gender": "female",   // gender now filled from onboarding
    "profile": { "preferred_session_type": "online", ... },
    "healthProfile": {
      "medicalConditions": ["severe migraines", "dizziness"],   // decrypted for the response
      "medications": null,
      "bloodType": null, "allergies": null
      // ...standard health-profile fields
    },
    "onboarding": {
      "is_completed": true,
      "completed_at": "2026-07-17T...",
      "aiOnboarding": {                       // the full decrypted onboarding record
        "chief_complaints": ["severe migraines", "dizziness"],
        "patient_age_group": "adult",
        "gender": "female",
        "consultation_mode": "online",
        "urgency": "this_week",
        "patient_summary": "Sarah is a 29-year-old woman experiencing severe migraines...",
        "specialties_needed": ["Neurology", "General Medicine"]
        // ...full BackendMatchPayload
      }
    }
  }
}
```

- Use `data.onboarding.aiOnboarding` to render the patient's health summary/history on the profile page.
- Structured clinical fields also live under `data.healthProfile` (`medicalConditions`, `medications`).
- This data **persists across sessions/logins** (it's in Postgres, not the temporary AI session).
- Clinical data is **encrypted at rest**; the API decrypts it in the response.

---

## 3. Behind the scenes (for backend/infra engineers)

- **Persistence trigger**: `MatchingService.match()` publishes `patient.onboarding.completed`
  (`{ authId, sessionId, finalPayload }`) — best-effort, never blocks matching. `user-provider-service`
  consumes it → `UserService.applyOnboardingPayload` upserts `users.gender`,
  `user_profiles.preferred_session_type`, `health_profiles` (conditions/medications encrypted), and
  `onboarding_state` (completed + full payload encrypted inside `step_data`). Idempotent.
- **New internal endpoint**: `GET /internal/users/by-auth/:authId` (HMAC) → user profile by **auth id**
  (the JWT `sub`). The existing `/internal/users/:id` keys on the internal `users.id`; use `by-auth`
  when all you have is the JWT subject.
- **Agent session-create** (`POST /ai/onboarding/session`) now accepts an optional
  `{ user_id, name }` body; `name` drives the personalised greeting.
- **Event**: `EVENT_NAMES.PATIENT_ONBOARDING_COMPLETED = 'patient.onboarding.completed'`.

## Known limitations
- Persistence fires on **match**, not on onboarding-finalize alone.
- Gender/age are **not** yet pre-filled from the account (planned) — the patient still states them.
