# Care Team — architecture check against the proposed flow

Raised 2026-09-04 from a mind map: a patient sits under a **lead** provider (a Doctor or a
Physiotherapist), and that lead has a team beneath them — Nutrition, Coach, Ancillary
support — with a **Doctor appearing as a team member under the Physiotherapist**.

Verdict: the flow is sound as a care model. **Nothing in the codebase supports it**, and
Week 8 is already written as though it does. Decide before Week 8 starts, not during.

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

## 4. Decisions needed before Week 8

**D-1. One team per patient, or one per pathway?** The map branches twice from Patient. Is
that two concurrent care pathways each with its own lead, or one team whose lead differs by
context? One `is_lead` per profile is simple; per-pathway needs a `pathway` column and
changes every query. This is the decision that most changes the build.

**D-2. Who may add a member?** The lead clinician, an admin, or the patient. It needs a
permission (`care_team:manage`) and an answer to whether a lead can add someone the patient
has never met.

**D-3. Membership must be profile-scoped, not account-scoped.** A nutritionist added for
the father must not see the mother. This is the exact trap Weeks 6 and 7 were spent
closing, and a team table keyed on the account would reopen it. Non-negotiable; noting it so
it is not rediscovered later.

**D-4. Consent per member.** Today's consent is caregiver → dependent. This map puts four
or five providers in front of one person's health data. Each addition should be consented
and audited, or the HIPAA position is weaker than what we already have — and weaker than the
one gap already logged in
[verified-consent-design.md](./verified-consent-design.md). The two are the same
conversation and should be decided together.

**D-5. What happens to the team when a profile is deactivated?** Deleting a family member
should not leave four clinicians holding standing access.

---

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

## 6. Recommendation

The flow in the map is right. Build it as one flat membership table with the role on the
membership, not as the two trees the diagram draws.

Answer D-1 and D-2 with Vijay this week, while Week 7 is still running, so Week 8 starts
against a model instead of an assumption.
