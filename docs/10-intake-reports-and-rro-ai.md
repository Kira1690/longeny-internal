# Intake, AI results, and the report timeline

Written for a frontend engineer who did not build the backend. Everything here is
live on the gateway at `http://localhost:3000/api/v1`.

Three things shipped in this area:

1. **Intake** — the questionnaire a patient fills in. It is the input everything
   clinical is derived from.
2. **RRO results** — the state the AI put a person in, and the summary a clinician
   reads before a consultation. You read these; you never generate them.
3. **Report timeline** — a person's uploaded reports, in the order the tests
   happened.

---

## 1. The one idea you need first

Everything on this page is **about a person, not about an account**.

One login (an account) can look after several people: yourself, your father, your
child. Each of those is a **profile**. A father has no password and never signs in —
his son manages everything for him.

So every call below needs to say *which person this is about*. You do that with one
header:

```
X-Active-Profile-Id: <profile id>
```

Leave the header off and the backend assumes you mean the account owner themselves.

Get the list of profiles from `GET /api/v1/profiles` (see
[07 — Multi-Profile / Family API](./07-profiles-rro-api.md)).

**If you send a profile id that is not yours, you get `404 Not Found`** — not 403.
That is deliberate: a 403 would tell someone guessing ids that the profile is real.
Do not treat that 404 as "bug in my code"; treat it as "not mine".

---

## 2. Intake

### Submit answers

```http
POST /api/v1/intake
Authorization: Bearer <token>
X-Active-Profile-Id: <profile id>        # omit for the account owner
Content-Type: application/json

{
  "symptoms": ["fatigue in the afternoon", "joint stiffness on waking"],
  "goals": ["reverse prediabetes"],
  "conditions": ["prediabetes"],
  "medications": ["metformin 500mg"],
  "pillarPriorities": ["nutrition", "sleep"],
  "notes": "worse since March"
}
```

Every field is optional and defaults to an empty list. `pillarPriorities` must be
drawn from: `nutrition`, `movement`, `sleep`, `stress`, `environment` — anything else
is a 400.

**201 Created**

```json
{
  "success": true,
  "data": {
    "id": "7c2a4d61-…",
    "profile_id": "df864dbd-…",
    "version": 1,
    "symptoms": ["fatigue in the afternoon", "joint stiffness on waking"],
    "goals": ["reverse prediabetes"],
    "conditions": ["prediabetes"],
    "medications": ["metformin 500mg"],
    "pillar_priorities": ["nutrition", "sleep"],
    "notes": "worse since March",
    "submitted_at": "2026-08-27T09:14:22.000Z"
  }
}
```

### Submitting again does not overwrite

Post the form a second time and you get **version 2**. Version 1 stays exactly as it
was. This matters: an AI classification points at the version it was derived from, so
if the answers could be edited underneath it, a clinical decision would have no
visible input.

For your UI this means: **there is no "update intake" call.** Editing is submitting
again.

### Read it back

```http
GET /api/v1/intake/{profileId}                # latest
GET /api/v1/intake/{profileId}?version=1      # a specific one
GET /api/v1/intake/{profileId}/history        # version numbers + dates only
```

---

## 3. RRO results

RRO is the care pathway. It has four states, in order:

| State | What it means |
|---|---|
| `intake` | Nothing has been assessed yet |
| `reverse` | There is something active to reverse |
| `restore` | Rebuilding function |
| `optimise` | Function is sound; improving on it |

Care can move **forward one step, hold, or fall back one step**. It cannot skip. Do
not build a UI that offers a jump from `intake` to `optimise` — the backend refuses it
with `422 INVALID_TRANSITION`.

### You do not trigger the AI

Classifying costs a model call and can move a person along the pathway, so it is a
backend-to-backend action. The frontend **reads the stored result**:

```http
GET /api/v1/rro/{profileId}/classification
```

```json
{
  "success": true,
  "data": {
    "state": "reverse",
    "confidence": 0.62,
    "pillar_priorities": ["nutrition", "sleep", "movement"],
    "rationale": "…why, in language a clinician can check…",
    "missing_data": ["Current medications"],
    "provider": "rules",
    "transitioned": false,
    "not_transitioned_reason": "low_confidence",
    "refused_reason": null,
    "created_at": "2026-08-27T09:20:00.000Z"
  }
}
```

Three fields decide what you show:

- **`refused_reason` is not null** → the AI declined (usually `insufficient_data`).
  Show a prompt to complete the intake. **Do not render a state.**
- **`transitioned` is `false`** → this result did not move the person.
  `not_transitioned_reason` says why: `low_confidence`, `already_in_state`,
  `invalid_transition`, or `refused`. It is still worth showing as an indication —
  label it as such, not as a decision.
- **`provider` is `"rules"`** → this came from the deterministic baseline, not the
  model. Those results are always advisory and never move anyone. Say so in the UI
  rather than presenting it as an AI assessment.

The person's actual current state comes from
`GET /api/v1/profiles/{id}/rro-state`, not from the classification. A classification
is an opinion; the state is the record.

### Pre-consult summary

```http
GET /api/v1/rro/{profileId}/summary
```

```json
{
  "success": true,
  "data": {
    "concerns": ["Diagnosed: prediabetes", "Reported: fatigue in the afternoon"],
    "missing_data": ["Current medications"],
    "red_flags": [
      {
        "finding": "chest pain",
        "severity": "emergency",
        "basis": "Chest pain requires same-day assessment"
      }
    ],
    "suggested_questions": ["How long has the main concern been present…"],
    "sufficient_data": true,
    "stale": false,
    "generated_at": "2026-08-27T09:21:00.000Z"
  }
}
```

Two flags you must respect:

- **`sufficient_data: false`** — the AI declined for lack of input. `concerns` and
  `red_flags` will be empty. Never present this as a clinical finding.
- **`stale: true`** — the intake has been resubmitted since this summary was made, so
  it describes answers that are no longer current. Mark it in the UI.

`red_flags[].severity` is `routine`, `urgent` or `emergency`. `emergency` should be
impossible to miss on screen. A red flag is a **triage urgency, not a diagnosis** —
the platform never names a disease.

Both endpoints answer `404` when nothing has been generated yet. That is normal for a
new profile, not an error to surface.

---

## 4. Report timeline

```http
GET /api/v1/profiles/{profileId}/reports?page=1&limit=20
```

```json
{
  "success": true,
  "data": [
    {
      "id": "…",
      "document_type": "lab_report",
      "title": "Lipid panel",
      "file_name": "lipids.pdf",
      "mime_type": "application/pdf",
      "reported_at": "2026-08-20T00:00:00.000Z",
      "created_at": "2026-08-27T08:00:00.000Z"
    }
  ]
}
```

Ordered by **`reported_at`** — when the test happened — not by upload time. Someone
uploading three years of history in one afternoon should still see it in the right
order. Older rows may have `reported_at: null`; those fall back to their upload date.

Uploading is the existing `POST /api/v1/documents/upload`, plus two things:

- send `X-Active-Profile-Id` so the report lands on the right person;
- send `reportedAt` (ISO date) so the timeline can order it.

### Who can read a timeline

| Caller | Result |
|---|---|
| The account that owns the profile | The reports |
| A provider with an active booking for that profile | The reports |
| A provider with no booking | `404` |
| Anyone else | `404` |

A provider's access follows their bookings. Cancel the booking and the access closes
again on the next request. There is no ambient "this clinic can see this patient".

---

## 5. Calendar invites for someone who cannot log in

A dependent profile has no account, so an appointment reaches them by email:

```http
POST /api/v1/bookings/calendar/invite
Authorization: Bearer <token>
Content-Type: application/json

{
  "profileId": "df864dbd-…",
  "title": "Consultation with Dr Rao",
  "startTime": "2026-09-01T09:00:00.000Z",
  "endTime": "2026-09-01T09:45:00.000Z",
  "description": "Bring recent labs",
  "location": "Clinic, Pune"
}
```

You never send an email address. The backend uses the addresses already registered on
that profile (`POST /api/v1/profiles/{id}/notification-targets`, channel `calendar`),
which is what stops this endpoint being a way to mail arbitrary people.

- **200** — delivered. `data.delivered` says how many addresses it reached.
- **502 `DELIVERY_FAILED`** — nothing was delivered, and the message says why (usually
  no calendar address registered for that profile). This is *not* a 200; do not show a
  success toast on it.

Re-sending the same appointment updates the recipient's existing calendar entry rather
than creating a second one.

---

## 6. Error codes you will actually hit

| Status | Code | What to do |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `error.details.fields` names each failing field. Show them inline. |
| 401 | `UNAUTHORIZED` / `TOKEN_REVOKED` | Refresh or send the user to login. |
| 403 | `FORBIDDEN` | The token lacks a permission (`intake:write`, `bookings:write`, …). Not fixable by retrying. |
| 404 | `NOT_FOUND` | Either it does not exist or it is not yours. Treat both the same. |
| 422 | `INVALID_TRANSITION` | The RRO move is not allowed. Only offer legal next states. |
| 429 | `RATE_LIMITED` | Intake is limited to 60 submissions per account per minute. |
| 502 | `AI_INVALID_RESPONSE` | The model returned something that failed the contract; nothing was stored. |
| 502 | `DELIVERY_FAILED` | An invite could not be delivered. |
| 503 | `SERVICE_UNAVAILABLE` | Profile ownership could not be verified, or the model is unreachable. Retry. |

Validation errors name the field but **never echo the value you sent** — intake bodies
carry health data, so it stays out of error responses and logs.

---

## 7. Permissions

| Permission | Held by | Needed for |
|---|---|---|
| `intake:write` | patient | `POST /intake` |
| `intake:read` | patient, provider | `GET /intake/*` |
| `rro:read` | patient, provider | `GET /rro/*` |
| `documents:read` | patient, provider | the report timeline |
| `bookings:write` | patient | sending a calendar invite |

These are on the token already; there is nothing for the frontend to request.

---

## 8. A complete flow

```
1. GET  /api/v1/profiles                          → pick who this is about
2. POST /api/v1/intake                            → X-Active-Profile-Id: <that person>
3. (backend classifies)
4. GET  /api/v1/profiles/{id}/rro-state           → where they are now
   GET  /api/v1/rro/{id}/classification           → what the AI thought, and whether it counted
   GET  /api/v1/rro/{id}/summary                  → what a clinician should look at
5. POST /api/v1/documents/upload                  → reports, with reportedAt
   GET  /api/v1/profiles/{id}/reports             → the timeline
6. POST /api/v1/bookings/calendar/invite          → tell a dependent about the appointment
```
