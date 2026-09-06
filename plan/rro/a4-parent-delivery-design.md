# A4 — Reaching a Person With No Login

Plan item A4. Decisions, not code. The tables exist (`notification_targets`,
`notification_log`) and `POST /internal/notify/profile` queues rows; nothing sends yet.
This file records what "send" will mean, so Week 7's calendar-invite card and Week 9's
check-in reminders build against a decided model rather than inventing one each.

---

## The problem

A dependent profile — typically a parent — is the subject of care but has **no account and
no login**. Everything the platform would normally show them in an app has to reach them
some other way: a reminder before a consultation, a check-in prompt, a calendar entry for
an appointment their child booked for them.

Three parties, and the distinction matters for every decision below:

| Party | Has a login | Consents | Receives messages |
|---|---|---|---|
| Account owner (caregiver) | Yes | For themselves and for dependents | Yes |
| Dependent profile (parent) | **No** | Cannot — the owner consents on their behalf | Yes, on their own phone/email |
| Provider | Yes | For themselves | Yes |

---

## Decisions

### D1 — Channels

`sms`, `email`, `calendar`. Already the `notification_channel` enum, now derived from
`@longeny/types`. Nothing else in the pilot: no WhatsApp, no push (a person with no login
has no device to push to), no voice.

### D2 — Who owns the contact detail

The **account owner** enters and edits a dependent's phone and email through
`POST /profiles/:id/notification-targets`. The dependent cannot manage their own, because
they have nowhere to sign in and do it. Contact details are encrypted at rest and never
returned by the API — responses carry `has_phone` style flags, matching how the profile
routes already behave.

### D3 — Consent gates delivery

No message goes to a dependent unless a `caregiver_consent` row of type `notifications` is
`granted` for that profile. Revoking that consent stops delivery immediately; queued rows
that have not yet sent are marked `failed` with reason `consent_revoked` rather than being
deleted, so the audit trail keeps the fact that we intended to send and chose not to.

This is the one rule that must be enforced in the service, not the UI.

### D4 — Verification before first send

A target is `is_verified: false` when created. An unverified target receives exactly one
message: a confirmation asking the person to reply/click to confirm. Nothing else sends
until verified.

Reason: the account owner types their parent's number by hand. A typo otherwise sends a
stranger a stream of someone else's health reminders — a disclosure incident that is
entirely preventable at this step.

### D5 — Providers

- **SMS**: one provider for the India pilot, DLT-registered sender with pre-approved
  templates (Indian regulation requires template registration; ad-hoc message bodies are
  rejected by the carriers). Candidate: MSG91 or Twilio India. **Decision owner: Milan.**
- **Email**: AWS SES in `ap-south-1`, the region the rest of the infrastructure already
  runs in. Sender identity `care@<domain>`, DKIM and SPF configured before first send.
- **Calendar**: an `.ics` attachment on an SES email, not a Google Calendar API invite.
  A calendar invite through the API requires the recipient to have a Google account and
  the platform to hold a token for them; a dependent has neither. An `.ics` works in every
  mail client and needs no account.

### D6 — Message content carries no health data

A message to a dependent says *that* something is scheduled, never *what about*. "You have
an appointment with Dr X on Tuesday at 10:00" — never a condition, a result, a medication
or a care-plan detail.

Two reasons: SMS is unencrypted in transit and often previews on a lock screen, and the
person holding the phone is not always the person the message is about.

### D7 — Retry policy

| Outcome | Behaviour |
|---|---|
| Transport accepted | `sent`, with the provider's message id in `metadata` |
| Transient failure (5xx, timeout, rate limit) | Retry 3 times with backoff 1m / 5m / 30m |
| Permanent failure (invalid number, hard bounce, unsubscribed) | `failed` immediately, no retry, target marked `is_active: false` |
| Consent revoked before send | `failed`, reason `consent_revoked`, no retry |

A `failed` row is an operational signal, not a swallowed error: repeated failures against
one target mean the caregiver typed the number wrong and needs telling.

### D8 — What `failed` means operationally

`notification_log` is the record of intent and outcome. A row means the platform tried.
Weekly, someone reviews failures — a dependent silently not receiving reminders is
indistinguishable from a healthy system unless somebody looks. In the pilot this is a
manual review; post-pilot it becomes an alert.

### D9 — Quiet hours

No message to a dependent between 21:00 and 08:00 in the profile's timezone, except an
`emergency`-severity item. Queue it for the next window instead. Older patients are the
core cohort; a 2 a.m. reminder buzz costs trust that a feature does not win back.

---

## What this implies for the build

| Card | Depends on |
|---|---|
| Week 7 — `POST /calendar/invite` | D5 (`.ics` over SES), D6 (content rule) |
| Week 7 — consultation reminders | D3 (consent gate), D9 (quiet hours) |
| Week 9 — check-in reminders | D3, D7, D9 |
| Any card that sends | D4 (verification first) |

Schema already supports all of it: `notification_targets.is_verified` exists,
`notification_log.status` covers `queued` / `sent` / `failed`, and `metadata` holds the
provider message id.

## Open — needs a decision from Milan before the Week-7 calendar card

1. SMS provider chosen and DLT templates registered (lead time is days, not hours — this
   is the long pole).
2. Sending domain and SES production access (SES starts sandboxed; only verified
   recipients receive mail until the account is moved out).
3. Where the verification reply lands for SMS — an inbound webhook, or a link in the
   message that hits an endpoint we have not built yet.
