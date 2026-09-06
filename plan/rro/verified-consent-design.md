# Verified Consent — design and status

Raised 2026-09-03 while documenting the consent types. Two separate findings: one small
defect in the published example, one structural gap in what consent currently means.

Gate: [00-engineering-standards.md](./00-engineering-standards.md).

---

## 1. Status today — who actually gives consent

**The account holder does. The person whose data it is is never asked.**

From `profile.service.ts`:

```ts
.values({
  profile_id: profileId,
  account_user_id: account.id,
  consent_type: data.consentType,
  status,
  granted_by: account.id,     // ← always the caller
  ...
})
```

`granted_by` is the logged-in account, on every path — insert and update alike. There is no
token, no email, no confirmation step and no field that could record one. A daughter adds
her father and records that he agreed; the father never sees anything.

What the system therefore holds is **a caregiver's claim that consent exists**, not consent.
The audit table records that claim faithfully and immutably, which is worth something — but
it answers "who said this?" and not "did the patient agree?".

For a HIPAA or DPDP conversation that distinction is the whole point. A regulator asking
"how do you know the father consented?" currently gets "his daughter ticked a box."

### Related: the consent type is unconstrained

`consent_type` is `varchar(100)` with a `z.string().min(1).max(100)` validator. Verified
against the running server: `consentType: "banana_pudding"` returns **201** and is stored.
The four intended values (`care_coordination`, `health_data`, `ai_analysis`,
`notifications`) exist only as a comment in the schema. An append-only audit table that
faithfully records `care_cordination` is still unqueryable.

### Related: Swagger's own example fails

The generated example body is not executable. Pressing **Execute** on it returns 400:

```json
{ "consentType": "", "status": "granted", "documentUrl": "", "notes": "" }
```

```
consentType   String must contain at least 1 character(s)
documentUrl   Invalid url
```

Two causes. The consent body has no `example` values in its OpenAPI fragment, so Swagger
emits empty strings; and `documentUrl: z.string().url().optional()` rejects `""`, which is
what a form sends for an untouched optional field. Both are small and both make the first
thing a new engineer tries fail.

---

## 2. What it should be

When a profile is added with an email address, that person is asked, by email, and their
answer is what gets recorded.

```
Account adds a profile with an email
        │
        ▼
consent request created  ── status: pending
        │
        ▼
email sent to the person, carrying a signed single-use link
        │
        ├─ they confirm  → status: granted,  method: verified_email
        ├─ they decline  → status: declined
        └─ nothing, 14d  → status: expired  (caregiver may re-send)
```

Three things this must not break.

**Not everyone can answer.** A parent with advanced dementia, a child with no email
address. Self-attested consent stays a legal, supported path — it is simply *labelled* as
self-attested rather than passed off as the same thing. That is a new column, not a new
status:

| `verification_method` | Meaning |
|---|---|
| `verified_email` | The person clicked the link themselves |
| `self_attested` | The account holder recorded it on their behalf |
| `guardian` | A minor, consented for by their guardian |
| `document` | A signed form, `document_url` set |

**A minor is a different case, not a failure case.** Below the age threshold, guardian
consent is the correct answer and should be recorded as `guardian` — with the profile's
`date_of_birth` (already stored, already encrypted) deciding which branch applies. The
threshold itself is a legal question, not an engineering one — see §4.

**The link is unauthenticated and reaches a stranger's inbox.** It must be single-use,
expiring, HMAC-signed and rate limited, and the landing page must show **no health data at
all** — only "«Name» would like to manage your care" and two buttons. An email address on
a profile is unverified until this flow verifies it, so the page is also the first place
that address is proven to belong to anyone.

**Revocation is the real win.** The same link lets a person withdraw later without an
account. That is the answer to "can a patient take their consent back?" — today they
cannot, because they were never in the loop.

---

## 3. What it costs

| Piece | h |
|---|---|
| Schema: status enum gains `pending`/`declined`/`expired`, `verification_method` column, `consent_request` table with token hash and expiry, migration | 4 |
| Request + send flow, reusing `mailer.service.ts` from Week 6, with the email copy | 5 |
| Public confirm/decline endpoints, token verification, single-use enforcement, rate limiting | 6 |
| Minor/guardian branch off `date_of_birth` | 4 |
| Revoke-by-link | 3 |
| E2E against a real mail server, no mocks: confirm, decline, expiry, replay, tampered token, wrong profile | 5 |
| **Backend** | **27** |
| Vijay — age threshold, jurisdiction, wording of the ask | 4 |
| Milan — real-domain deliverability, SPF/DKIM so these do not land in spam | 3 |
| **Total** | **34** |

Plus 3h for the two small defects above (constrain `consent_type` to an enum with a
migration for existing rows; add Swagger examples and accept `""` for optional URLs).

---

## 4. Decisions needed before it is built

1. **Age threshold, and whose law.** India's DPDP Act treats under-18s as children needing
   verifiable guardian consent; health contexts elsewhere differ. Infrastructure is in
   ap-south-1 and the pilot is Indian, but this is Vijay's call with whatever legal advice
   the clinic has — not an engineering guess. Everything else is built and waiting on one
   number.
2. **Does unverified consent restrict anything?** Either a `pending` profile is fully
   usable and merely labelled, or some actions are blocked until it is granted. The first
   ships sooner and is honest; the second is stricter and is a product decision.
3. **Re-send policy.** How many reminders, how far apart, before it is harassment.
4. **What the email says.** It reaches an elderly person who was not expecting it. The
   wording matters more than the code.

---

## 5. Where it lands

Week 7 is full — 35h of 35h for Vishal. This is Week 8 work.

Week 8's backend demand is already 83h against 35h of capacity
([capacity-weeks-07-12.md](./capacity-weeks-07-12.md)), so adding 27h makes it 110h and
pushes the track past Week 13 on one backend developer.

That is the trade to put in front of the client, not to absorb silently. This feature is
the difference between "we record that consent was given" and "the patient gave consent",
which is the strongest thing in the whole tenancy story — but it is a third of a
developer-week-and-a-half, and something else moves.
