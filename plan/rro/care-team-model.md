# Care Team — architecture check against the proposed flow

Raised 2026-09-04 from a mind map: a patient sits under a **lead** provider (a Doctor or a
Physiotherapist), and that lead has a team beneath them — Nutrition, Coach, Ancillary
support — with a **Doctor appearing as a team member under the Physiotherapist**.

Verdict: the flow is sound as a care model. **Nothing in the codebase supports it**, and
Week 8 is already written as though it does. Decide before Week 8 starts, not during.

> **DECIDED 2026-09-06.** All five decisions are answered in §4 below. Week 8 §8.1/§8.2 are
> unblocked and should be built against this model. One item is deliberately *not* settled
> here because it is not an engineering question — see §7.

---

## 1. What exists today

| The map needs | What the code has |
|---|---|
| A patient's care team | **No table.** `care_team`, `assignment`, `provider_patient` — none exist in any schema |
| A provider seeing their patients | Access **derived from a booking**, nothing else |
| A role within a team | `providers.specialties`, a jsonb array on the provider |
| A lead vs a supporting member | No concept at all |

`booking-service` is explicit about the access rule, in its own words:

> there is no ambient provider access, only access derived from a booking that exists and
> has not been cancelled.

That was a deliberate, good decision for one-to-one consultations. It does not carry a team.

---

## 2. The three mismatches

### M1 — Booking-derived access cannot hold a team

A booking is an *encounter*. A care team is *standing* — a nutritionist needs the plan
between appointments, and a coach may never hold a booking at all. Under today's rule a
team member with no booking sees nothing, so the map's supporting roles simply cannot
function.

The fix is not to loosen the booking rule. It is a second, explicit basis for access —
team membership — that is granted deliberately, is revocable, and is audited. Booking-derived
access stays for the one-off consultation.

### M2 — Role belongs to the membership, not the provider

The map has a **Doctor under the Physiotherapist**. The same person is a lead for one
patient and a supporting member for another. `providers.specialties` says what someone
*is*; it cannot say what they *do for this patient*. The role has to live on the
membership row.

### M3 — Week 8 is written against a model that does not exist

[week-08-workspace.md](./week-08-workspace.md) §8.1 and §8.2:

> `GET /workspace/queue` — profiles **assigned** to the calling provider
> a provider sees only profiles **linked** to them
> every route rejects a provider with **no link** to the profile

There is no assignment and no link. Those are the week's two largest cards — 20h and 25h,
45h of 35h capacity — and both rest on this. **Week 8 cannot be built as written.**

---

## 3. Proposed model

The tree in the map is a *view*, not a structure. Two parallel trees that both contain
Nutrition and Ancillary support would duplicate the same roles under two parents. One flat
membership table renders that tree and avoids the duplication:

```
care_team_member
  profile_id     -> the patient (a PROFILE, not an account — see D-3)
  provider_id    -> the clinician
  role           -> lead | doctor | physiotherapist | nutrition | coach | ancillary
  is_lead        -> exactly one true per active team
  status         -> active | removed
  added_by       -> who put them there
  consent_id     -> the patient's agreement to this person seeing their data
  created_at / removed_at
```

Access for a provider then becomes: an active booking **or** an active team membership —
resolved in one place, the way `assertOwnership` already works for profiles, rather than
re-implemented per service.

---

## 4. Decisions — answered

### D-1. One team per patient, one lead. No pathway column. **DECIDED**

The map branches twice from Patient, but that is the diagram showing *"the lead has a
team"* twice over, not two concurrent pathways. Nothing in the product asks for a patient
to be under two leads at once, and a `pathway` column multiplies every membership query by
a scope we have no requirement for.

Enforced by a partial unique index — exactly one `is_lead = true` per profile among
`status = 'active'` rows — so the rule is the database's, not a service's good intentions.

The deciding argument is reversibility. Going from one-team to per-pathway later is an
additive column plus an index change and a backfill that puts every existing row in the
default pathway. Going the other direction is a merge of rows that disagree about who the
lead is, with no correct answer. Take the change that stays cheap if we are wrong.

If pathways are ever needed they will almost certainly align with something that already
exists — the RRO state, or a care plan — and the column should reference that rather than
invent a parallel taxonomy.

### D-2. A lead or an admin adds. Membership alone grants nothing. **DECIDED**

Permission `care_team:manage`, held by `admin` and by the member whose row has
`is_lead = true` on that profile. The account holder may **remove** anyone at any time and
needs no permission to do it — it is their family member's data.

The hard half of this question — *may a lead add someone the patient has never met?* — is
answered by taking it out of the membership decision entirely. **Adding a member does not
grant access.** A new row lands as `status = 'pending_consent'` and resolves to no access
at all. Access begins when a consent record for that specific provider exists (D-4). So a
lead may refer freely, which is how referral actually works, and the patient still decides
who reads their data.

That split is what makes this safe to decide without a clinical debate: the permission
governs *who may propose*, and consent governs *who may see*.

### D-3. Profile-scoped, never account-scoped. **DECIDED — non-negotiable**

`care_team_member.profile_id`, never `account_user_id`. A nutritionist added for the father
must not see the mother. This is the exact trap Weeks 6 and 7 were spent closing, and a
team table keyed on the account reopens all of it in one column.

### D-4. One consent per member, on the same machinery as verified consent. **DECIDED**

Not one blanket "I agree to a care team" — a consent that cannot name who it covers cannot
be revoked for one person, and "I withdraw from the nutritionist" is the request that will
actually arrive.

The important part is *what it is built on*. [verified-consent-design.md](./verified-consent-design.md)
already needs a `consent_request` table with a hashed single-use token, an expiry, an
email send and public confirm/decline endpoints. That machinery answers "does this person
agree to X?" and does not care what X is. Build it once with a subject, and a care-team
invitation is the same flow with different copy:

| Subject | The question asked |
|---|---|
| `caregiver` | May «account holder» manage your care? |
| `care_team_member` | May «Dr Rao» join your care team as your physiotherapist? |

This is why A1 and A2 are the same conversation, and it changes the order of work: **build
A2's consent machinery first, then A1 consumes it.** Done the other way round, the team
table gets its own bespoke consent and the two disagree within a week.

### D-5. Deactivating a profile ends every membership. **DECIDED**

In the same transaction as the soft delete: every `active` and `pending_consent` row for
that profile moves to `removed`, with `removed_reason = 'profile_deactivated'`. The rows
survive for audit; the access does not.

This is the same rule Week 7 just closed for notification targets — a deactivated profile
kept its targets and stayed contactable. A care team is the larger version of that bug:
deleting a family member while four clinicians keep standing access is worse than an
unwanted email. See D7 in [CARRY-FORWARD.md](./CARRY-FORWARD.md).

The access resolver must also re-check profile status on every call rather than trust the
membership row, for the same reason the internal HMAC routes now do.

## 5. Cost, and what it displaces

| | h |
|---|---|
| Schema, migration, indexes, one resolver for booking-or-membership access | 6 |
| Team CRUD — add, remove, change role, transfer lead — permission-gated and audited | 8 |
| Rework of Week 8 §8.1 and §8.2 to query membership instead of an imagined link | 4 |
| Cross-tenant and cross-provider tests, per-role negative cases | 5 |
| **Backend** | **23** |
| Vijay — D-1 and D-2, the clinical shape of a team | 4 |

Week 8's backend demand is already **83h against 35h capacity**
([capacity-weeks-07-12.md](./capacity-weeks-07-12.md)). This is not additive on top —
23h of it **replaces** part of §8.1 and §8.2, which cannot be built without it. The net
new is roughly 10h, but the sequencing is what matters: the model has to be agreed before
the workspace is written, or the workspace is written twice.

---

## 6. Recommendation — adopted

The flow in the map is right. Built as one flat membership table with the role on the
membership, not as the two trees the diagram draws.

Sequence, now that D-4 is answered: **A2's consent machinery → this table → Week 8 §8.1 and
§8.2.** Building the workspace first means building it twice.

---

## 7. The one thing still open, and it is not engineering

Everything above is decided and buildable. What is **not** settled is the *clinical* shape
of a team — whether "Ancillary support" is one role or several, whether a coach without a
clinical qualification may hold standing access to a diagnosis, and what a lead is
accountable for when a member acts.

None of that blocks the schema: `role` is an enum and adding a value is a migration.
It does block going live with real patients, and it belongs to whoever carries clinical
responsibility for the pilot, not to the person writing the table.

Build against this model now. Put §7 in front of the clinical owner before the pilot, not
before the code.
