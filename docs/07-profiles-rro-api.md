# Multi-Profile / Family (RRO) API

The platform is multi-tenant at the **profile** level. One authenticated **account**
(a `users` row, identified by the JWT `sub`) owns many **profiles**. A profile is the
*subject* of care — the account owner themselves (`self`), or a dependent such as a
parent. Dependent profiles have **no login**; they are reached only through
notification channels (SMS / email / calendar).

All health data is scoped by `profile_id`. A `null` `profile_id` on legacy user-scoped
rows means "the account owner's own (self) record".

- Base URL (local): `http://localhost:3002`
- Swagger: `http://localhost:3002/docs` (tag **Profiles**)
- Auth: `Authorization: Bearer <access token>` on all `/profiles/*` routes.
- Active profile: after `POST /profiles/:id/activate`, the client sends
  `X-Active-Profile-Id: <id>` on subsequent scoped requests. Every profile route
  independently re-checks ownership, so a stolen/guessed id from another account is
  rejected with `403`.

Standard envelope: `{ "success": true, "data": ... }` on success;
`{ "success": false, "error": { "code", "message" } }` on failure.

---

## Profiles

### `GET /profiles`
List all profiles under the account. The account's `self` profile is created
automatically on first call.

```json
{ "success": true, "data": [
  { "id": "…", "relation": "self", "is_self": true, "first_name": "Vishal",
    "status": "active", "has_phone": false, "has_date_of_birth": false },
  { "id": "…", "relation": "father", "is_self": false, "first_name": "Ramesh",
    "status": "active", "has_phone": true }
] }
```

### `POST /profiles`
Create a dependent (no-login) profile.

| Field | Type | Notes |
|-------|------|-------|
| `relation` | `self\|father\|mother\|spouse\|child\|sibling\|other` | required |
| `firstName` | string | required |
| `lastName`, `email`, `phone`, `dateOfBirth` (YYYY-MM-DD), `gender`, `avatarUrl`, `notes` | string | optional |
| `goal` | string | optional — seeds the RRO state goal |

`phone` and `dateOfBirth` are encrypted at rest and never returned; the response
exposes `has_phone` / `has_date_of_birth` booleans instead. `201` on success. A new
profile starts in RRO state `intake`. Only one `self` profile is allowed per account.

### `GET /profiles/:id`
One profile plus its current RRO state (`data.rroState`). `403` if the profile is not
owned by the caller, `404` if it does not exist.

### `PATCH /profiles/:id`
Partial update. Same fields as create (all optional); nullable fields accept `null`.

### `DELETE /profiles/:id`
Soft-deactivate (`status: "inactive"`). The `self` profile cannot be deactivated
(`400`).

### `POST /profiles/:id/activate`
Validate that the account may act as this profile and return the active context:

```json
{ "success": true, "data": {
  "accountUserId": "…", "activeProfileId": "…",
  "profile": { … }, "rroState": { "current_state": "reverse", … } } }
```

`400` if the profile is inactive, `403`/`404` on ownership failure.

---

## Caregiver consent

### `POST /profiles/:id/consent`
Record consent the account owner grants on the dependent's behalf. Upserts by
`consentType`, so re-posting the same type flips status rather than duplicating; every
change is written to an audit trail.

| Field | Type | Notes |
|-------|------|-------|
| `consentType` | string | e.g. `health_data`, `ai_analysis`, `care_coordination`, `notifications` |
| `status` | `granted\|revoked` | default `granted` |
| `documentUrl`, `notes` | string | optional |

`201`. Response includes `granted_at` / `revoked_at`.

### `GET /profiles/:id/consent`
List all consent records for the profile (most-recently-updated first).

---

## RRO state

### `GET /profiles/:id/rro-state`
Current RRO state + the last 20 transitions.

```json
{ "success": true, "data": {
  "current_state": "reverse", "goal": "Reverse type-2 diabetes",
  "history": [
    { "from_state": "intake", "to_state": "reverse", "source": "ai_classifier", … },
    { "from_state": null, "to_state": "intake", "source": "system", … }
  ] } }
```

States: `intake → reverse → restore → optimise` (transitions are not restricted to a
fixed order; the AI classifier or a clinician may move to any state).

---

## Parent notifications

### `POST /profiles/:id/notification-targets`
Register a channel for reaching a no-login dependent.

| Field | Type | Notes |
|-------|------|-------|
| `channel` | `sms\|email\|calendar` | required |
| `destination` | string | phone / email / calendar address — encrypted at rest |
| `calendarId` | string | optional |

### `GET /profiles/:id/notifications`
Delivery history for the profile (most recent 50).

---

## Internal endpoints (service-to-service, HMAC)

These require the `X-Service-Name` / `X-Timestamp` / `X-Signature` HMAC headers, not a
JWT. Called by the AI classifier and other backend services — **not** from the browser.

### `POST /internal/rro-state/transition`
Body: `{ profileId, toState, reason?, source?, goal?, metadata? }` where
`source` ∈ `ai_classifier|clinician|system`. Updates the current state and appends a
transition. Returns `{ profileId, fromState, toState, transitionId }`.

### `POST /internal/notify/profile`
Body: `{ profileId, channel?, subject?, body, metadata? }`. Fans out to the profile's
active targets (all channels if `channel` omitted) and records each send in the
notification log. Returns `{ profileId, delivered, entries }`.
