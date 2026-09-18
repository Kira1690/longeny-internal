# Week 8 — Reports, Benchmarks and Scoring

**Scope set 2026-09-14 by the client-side lead**, replacing the clinician workspace that
this slot previously held. The workspace week did not shrink — it moved, and is now
[week-08-workspace.md](./week-08-workspace.md) awaiting a slot. See §6.

Gate: [00-engineering-standards.md](./00-engineering-standards.md).
Register: [CARRY-FORWARD.md](./CARRY-FORWARD.md).

---

## 1. Why this week exists

**A report today is only a file.** `documents` stores a title, a type, a `reported_at` and
an S3 key. Nothing inside it is readable by the system. And the RRO classifier scores the
five pillars from **intake text alone** — no measured number has ever reached it.

So the care stage a patient is placed in currently rests on what they typed into a form.
This week puts measurement underneath it:

```
report (file)  →  readings (values)  →  benchmark (judgement)  →  score  →  advice
```

Each arrow is a card. The last one deliberately stops short of acting — see §4.

---

## 2. Cards

### Vishal — backend — 35h

| # | Card | h |
|---|---|---|
| V-W8-1 | Biomarker readings schema — give a report a body | 6 |
| V-W8-2 | Report → readings API, values tied to their source file | 7 |
| V-W8-3 | Reference ranges + benchmark | 6 |
| V-W8-4 | Trend API — direction of travel | 6 |
| V-W8-5 | Pillar scoring engine — versioned and explainable | 7 |
| V-W8-6 | Overall RRO score — advisory, never automatic | 3 |

### Pushparaj — AI — 26h

| # | Card | h |
|---|---|---|
| P-W7-1 | Classifier fixture corpus *(carry-over, no AWS needed)* | 8 |
| P-W7-5 | Pre-consult summary prompt *(carry-over, no AWS needed)* | 4 |
| P-W8-1 | written, **cannot run (Bedrock)**; eval set synthetic | Contract `readingExtractionOutputSchema` (extract-v1): per-value `uncertain` + reason, `unmapped`, `unreadable` — nothing seen may go unsaid. Versioned prompt with a closed code list (13 markers). 3 synthetic layouts (tabular+flags, key–value with an injected instruction, scanned two-column with OCR noise), hand-labelled. Scorer reports **silent misses separately from accuracy**, plus wrong value/unit/code, unflagged uncertainty and extra values (reference interval read as a value). 10 scorer tests. **Needs anonymised real reports from ≥3 labs** to be done — ask the client. |
| P-W8-2 | tooling built, **needs a clinician** | 10 lab-panel cases chosen to find where the engine misleads. `eval/score-validation/generate.ts` → CSV with the engine's pillar and overall scores beside blank `clinician_score`/`category`/`note`; `compare.ts` reads it back and lists **engine-healthier-than-clinician first**, by category (bad_weight, missing_data, wrong_range, ambiguous). Placeholder ranges now live in one module shared with the seed. **Visible before any clinician looks:** averaging lets one bad value hide — sv-02 (HbA1c 6.2, prediabetic) scores nutrition 82.5 because three lipids are optimal; sv-04 scores triglycerides 620 the same as 151. Take both to VG-W8-2. |
| P-W8-1 | Report extraction prompt + eval set | 8 |
| P-W8-2 | Score validation against clinician judgement | 6 |

### Milan — DevOps — 15h (+1h waiting on the client)

| # | Card | h |
|---|---|---|
| M-W8-2 | Report storage hardening — the bucket holds patient labs now | 5 |
| P-W7-1 | built; **expected answers are drafts** | 40 classifier fixtures (10 reverse, 10 restore, 10 optimise, 4 intake, 2 refusals, 2 injection, 2 mixed), each `review: 'draft'` until VG-W7-1 agrees them. `eval/run-classifier-eval.ts [rules|bedrock]` parses every output against the service's own contract. **Rules baseline: 36/40 strict, 40/40 lenient, top pillar 19/22, 0 contract-invalid.** It never answers `intake` — that is the model's first bar. |
| P-W7-5 | eval built | Summary prompt already existed; 8 red-flag fixtures now score it. Rules baseline finds 5/6 flags at the right severity, invents 0 — misses "can't catch my breath" because it matches words, not meaning. |
| M-W8-3 | Week 8 deploy and server verification | 4 |
| M-W8-4 | Gateway health honesty | 6 |
| M-W8-5 | Switch RRO provider to Bedrock — **blocked on client billing** | 1 |

### Vijay — architect — 21h

| # | Card | h |
|---|---|---|
| VG-W7-1…4 | *carry-over reviews* | 14 |
| VG-W8-1 | **Reference ranges** | 4 |
| VG-W8-2 | Scoring weights + the no-auto-transition rule | 3 |

**97h active. 28h blocked on the client.**

---

## 3. The dependency that decides the week

**VG-W8-1 blocks 19h of backend work.** V-W8-3, V-W8-4 and V-W8-5 have nothing to compare
a value against until a clinician says what normal is. If reference ranges arrive on
Friday, more than half of Vishal's week cannot finish.

It is named "blocks 19h of backend" on the board for that reason. Start narrow — ten
biomarkers that change a care decision beat sixty that fill a table.

Each range carries its **source**. Ranges differ by lab and by guideline body; a patient
told they are out of range is entitled to an answer to "according to whom".

---

## 4. The rule this week must not lose

**A computed score never moves a patient between care stages on its own.**

The rules classifier already works this way, deliberately: its confidence never reaches the
transition floor, so it can advise and cannot act. That was an easy rule to hold when the
input was intake prose.

It gets harder now. When the input is a lab panel the output *feels* objective, and the
pull to let it transition automatically is much stronger. But a wrong automatic transition
is the least visible failure this system can produce — the patient cannot see it, and the
clinician has no reason to go looking. It silently changes what care someone is offered.

V-W8-6 enforces it with a test that scoring writes no `rro_transition` row. VG-W8-2 asks
Vijay to confirm it in writing rather than leaving it as an engineering habit.

---

## 5. Manual entry before AI extraction

V-W8-2 (a human types the values) ships before P-W8-1 (a model reads the PDF).

Partly forced: Bedrock is unreachable while the client's AWS billing is unresolved. But it
is the right order regardless. A misread decimal in a lab value is a clinical error, and
scanned-report OCR is exactly where that happens. Extraction should propose draft readings
a human confirms — speeding up a step that already works, rather than being the only way
the step works.

P-W8-1's eval records **miss rate separately from accuracy**: a value silently skipped is
worse than one read wrongly, because nobody goes looking for it.

---

## 6. What moved out, and what it costs

| Deferred | h | Why it matters |
|---|---|---|
| Verified consent by email | 27 | [verified-consent-design.md](./verified-consent-design.md) — decided, not built |
| Care team model | 23 | [care-team-model.md](./care-team-model.md) — decided, not built |
| Clinician queue + patient workspace | 45 | [week-08-workspace.md](./week-08-workspace.md) — needs the care team first |
| D2 profile scoping | 6 | carried since Week 7 |

The ordering constraint from the care-team decision still stands and still binds:

> consent machinery → care team + access resolver → queue + workspace

Nothing this week breaks that chain; it simply does not advance it.

---

## 7. Exit criteria

- A value entered from a real report appears in a trend, is benchmarked against a range
  that names its source, and contributes to a pillar score.
- A score can be recomputed from stored readings and produces the identical number.
- Every score names the readings behind it.
- Producing a score writes no transition — asserted by a test.
- Missing data lowers confidence; it does not score zero.
- Unit mismatch is an error, never a silent comparison.
- Verified on the deployed server, not only locally — Week 7 lost three defects to that gap.
- `typecheck` 0 · `lint` clean · E2E green on real infrastructure · migrated to `BraveLabs`.

---

## 8. Progress — 2026-09-18

**Built in longeny-internal, not migrated.** Tested end to end on real Postgres; the full
run is 13/14 suites green plus one stale Week 7 suite fixed (below).

| Card | State | What exists |
|---|---|---|
| V-W8-1 | built, tested | `biomarker_readings` (append-only, corrections via `supersedes_id`, every value tied to a report by FK) and `reference_ranges` (source required, `is_placeholder` defaults **true**, retire instead of delete, check constraints for bound order and optimal-inside-normal). Migration `0004`. |
| V-W8-3 | engine built, **ranges are placeholders** | Pure engine `services/benchmark/engine.ts` (24 unit tests). `GET /profiles/:id/benchmarks`, `GET /reference-ranges`, both through the gateway. 56 E2E checks. |
| V-W8-2 | built, tested | `POST /reports/:id/readings` (batch, all-or-nothing, lab reports only, sample date defaults to the report date), `GET /reports/:id/readings` (history incl. corrections), `POST /readings/:id/corrections` (append-only; 409 on a replaced reading; racing corrections decided by the unique constraint). Owner-only writes — a booked provider can read but not write until the care team model says who may. 66 E2E checks. |
| V-W8-4 | built, tested | `GET /profiles/:id/trends?marker=`. `direction` (rising/falling/flat) is arithmetic; `toward_range` (improving/worsening/unchanged) is judged against the target band and is null without a usable range — rising is good for HDL and bad for HbA1c, and is never guessed. Mixed units are cut to the newest unit and counted, never converted. 18 unit tests, E2E through the readings API. |
| V-W8-5 | built, tested, **rules are placeholders** | Pure scorer `benchmark/scoring.ts`, `SCORING_VERSION = placeholder-2026-09.1`. Pillar = mean points of its markers (optimal 100 / normal 70 / low·high 30 — placeholders); readings with no reference, a unit mismatch or no pillar are listed as `unscored` with the reason. Every score is `provisional` until VG-W8-2. `rro_scores` keeps each score with its full explanation and a sha256 fingerprint of its inputs; `stale` when inputs change. |
| V-W8-6 | built, tested | Overall = weighted mean of pillars **that have data** (missing labs are not bad labs; weights equal until VG-W8-2). `POST /profiles/:id/scores` (201 new / 200 reused), `GET /profiles/:id/scores`. `advisory: true` always. `ScoreService` has no path to user-provider; the E2E asserts no `rro_transition` row and an unchanged `rro_state`. Recompute after deleting a stored score gives a byte-identical result. |
| M-W8-4 | built, tested | `GATEWAY_ABSENT_SERVICES` (validated against the downstream list; a typo stops boot) is the one definition of "not deployed here". `/health` is 200 only when every *expected* downstream is healthy, names `failing` and `notDeployed`; `/health/live` is the process alone. The deploy hook trusts the gateway's HTTP status again and keeps no list of its own. 7 unit + 12 E2E (real gateway processes on spare ports). **Needs `GATEWAY_ABSENT_SERVICES=booking,payment` in the dev box `.env` at the next deploy (M-W8-3).** |
| M-W8-2 | code built + tested; **AWS not applied (needs approval)** | Upload body validated by `uploadDocumentSchema` (50 MB, PDF/JPEG/PNG/WebP/DICOM); size **and type** signed into the presigned link so S3 refuses a mismatch (13 E2E against LocalStack with signature validation on). Fixed the SDK checksum defect that made every upload link dead, and the placeholder-key/region/bucket defaults (CARRY-FORWARD D12–14). `infrastructure/s3/reports-bucket.sh apply|verify`: SSE-KMS, public-access block, ACLs off, versioning, deny non-TLS, access logs to their own bucket, abandoned-upload cleanup, CORS, role grant. **Retention not set** — current reports are kept until the consent text names a period. |

**Placeholder rule, as agreed on the 2026-09-18 call.** We do not have the clinical
parameters. `seed-placeholder-ranges.ts` loads 7 test ranges for dev only, all
`is_placeholder = true`; every verdict against one comes back `provisional: true`, and
`meta.provisional` says so for the page. Real ranges arrive as rows — reviewed rows with
`is_placeholder = false`, then `retired_at` on the placeholders. No code change.

The table VG-W8-1 must fill, one row per marker: marker, unit, sex (any/male/female),
age band, normal low/high, optimal low/high, pillar, source.

**Found while building:**

1. **Demographics are not available to ai-content.** Profile resolution carries no PII by
   design, so sex- and age-specific ranges cannot be applied. The engine supports them; the
   endpoint answers `no_reference / needs_demographics` rather than borrow someone else's
   range, and `meta.demographics = "unavailable"`. Needs an HMAC route returning sex + age
   band (not DOB) — not yet a card.
2. **The ai-classify E2E had been red since 2026-09-10.** Section 4 submitted an empty
   intake through the API and expected the classifier to refuse it; the Week 7 fix that
   rejects empty intakes at submit made that impossible. The test now asserts the 400 and
   seeds a legacy empty row directly to keep the classifier's refusal covered. 60/60.
3. Reports and benchmarks now share one access rule, `ProfileAccessService.assertCanRead`
   (owner, or provider with an active booking), instead of a copy in each controller.
