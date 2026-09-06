# Week-6 Security Audit — Findings Register

Adversarial audit of the Week-6 multi-profile (RRO) backend, 2026-08-26. Audited against
[00-engineering-standards.md](./00-engineering-standards.md). Every finding below was
reproduced against the running service and the live dev database before being recorded —
nothing here is a code-reading guess.

The audit also checked the claims in [README.md](./README.md) rather than trusting them.
Three were overstated; they are marked below and the README has been corrected.

---

## C1 — Request identity lived in a process-global object (CRITICAL, fixed)

**What was wrong.** Elysia's `.state()` store is a singleton per instance, not per request.
`requireAuth` wrote the authenticated identity into it, so every in-flight request shared
one `userId`, `userRoles`, `userPermissions` and `activeProfileId`. Whichever request last
ran its `onBeforeHandle` set the values every other request then read — ownership guards,
permission checks, the rate-limit key and the audit actor included.

**Reproduced.** Two accounts, one owning 20 profiles and one owning 3, issuing interleaved
`GET /profiles`:

```
SERIAL     A count=20  B count=3          ← correct
CONCURRENT 12/24 responses carried the wrong account's data
```

Writes were worse: of 8 concurrent profile creations, 6 landed under the wrong account —
health-subject rows containing PII submitted by one family, stored under another's.

**Why the tests missed it.** Every isolation test in the suite passed. They ran requests
one at a time, which is the single ordering in which the bug cannot appear. A serial test
of a concurrency bug reports confidence it has not earned.

**Fixed.** `packages/middleware/src/request-context.ts` keys request state on the `Request`
object in a `WeakMap`. Middleware reads and writes it through `requestCtx(request)`; route
handlers keep reading `store.userId` because a scoped `derive` hands them the same object.
Two earlier attempts failed and are documented in that file so they are not retried: a
scoped `derive` shadowing `store` does not reach hooks, and nesting it inside the guard
plugin does not reach the parent's routes.

**Verified after the fix.** `0/24` cross-account reads, `0/6` cross-account writes.
Permanent tests added — `profiles-rro.e2e.ts` §27–28 now assert isolation under overlap,
and fail against the old build.

## C2 — The audit log named the wrong actor (CRITICAL, fixed)

The PHI audit read the same shared `store.userId`. During the C1 leak test all 20 rows were
attributed to one account, including the 9 requests in which the *other* account
successfully read data that was not its own. The compliance record did not merely miss the
breach — it attributed it to the victim.

Fixed by the same change. Verified: the two accounts' concurrent requests now produce 17
audit rows each, correctly attributed.

While fixing this, a second audit defect was found and fixed: collection routes carry no
`:id` param, so their rows were written with `profile_id = NULL` — the column an access
review filters on. The entry now falls back to the acting profile.

---

## Findings by severity

| # | Finding | Severity | Status |
|---|---|---|---|
| C1 | Request identity in a shared singleton — cross-tenant reads and writes under concurrency | Critical | **Fixed + regression test** |
| C2 | Audit log attributed breaches to the victim | Critical | **Fixed + verified** |
| H1 | `phone_hash` / `destination_hash` stored plaintext beside their own ciphertext | High | Fixed |
| H2 | Google sign-in took over any password account by email match; `aud` check skipped when `GOOGLE_CLIENT_ID` unset | High | Fixed |
| H3 | Working super_admin password committed to git, seeded with no environment guard | High | Fixed |
| H4 | Any admin could grant themselves super_admin (`PUT /auth/users/:userId/roles`) | High | Fixed |
| H5 | Role change, password change and password reset never revoked outstanding tokens | High | Fixed |
| H6 | Calendar OAuth `state` trusted as a provider id — one provider could hijack another's calendar link | High | Fixed |
| M1 | GDPR export and erasure ignored all seven RRO tables | Medium | Fixed |
| M2 | `PUT /payments/refunds/:id/approve` 404'd — its guard protected a doubled prefix | Medium | Fixed |
| M3 | "Append-only" audit tables were freely mutable | Medium | Fixed (trigger) + infra item |
| M4 | HMAC raw body on the shared store — same class as C1 | Medium | Fixed with C1; verified 0/24 correctly-signed concurrent internal calls wrongly rejected |
| M5 | Ownership mismatch threw 403 in booking/refund — an existence oracle | Medium | Fixed |
| M6 | Gateway `optionalAuth` never checked revocation | Medium | Fixed |
| M7 | `/progress/*` had no permission guard — layer 2 missing | Medium | Fixed |
| M8 | `HMAC_SECRET` / `ENCRYPTION_KEY` defaulted to public literals in every environment | Medium | Fixed |

## README claims that were overstated

| Claim | What was actually true |
|---|---|
| "Cross-tenant isolation tests now exist" | They existed and passed, against a build that leaked under concurrency. Now true, with concurrent cases. |
| R9 "payment-service has no role guard — Fixed" | The guard was written correctly onto a path that did not exist (doubled `/payments` prefix). The endpoint 404'd and was never exercised. Now reachable and tested. |
| R8 "a missing var fails at boot" | True for the JWT secrets, false for `HMAC_SECRET` and `ENCRYPTION_KEY`, which had public defaults. Now enforced outside development. |

## Verified correct

Recorded because it is as useful as the findings:

- `assertOwnership` is a single choke point, called first by every method taking a
  `profileId`, and answers 404 rather than 403 — confirmed live.
- Denials are audited: 401 / 403 / 404 / 429 / 503 rows all present, not just successes.
- Fail-closed revocation on health-data routes genuinely fires (503 rows in the log).
- Per-account rate limiting works and does not spill between accounts.
- One production JWT mint path, always with a `jti`, always from `resolveIdentity`; refresh
  re-resolves from the database, so permissions genuinely shrink.
- Refresh rotation with reuse detection revokes every session on replay.
- No service trusts gateway-set `X-User-*` headers — every one re-verifies the JWT.
- The error handler leaks no stack traces, SQL or row counts.
- `sanitizeProfile` keeps encrypted columns and hashes out of every response.

## Fixed beyond the findings

Work the audit prompted that was not itself a finding:

- **`/progress/*` was guarded by `users:read` / `users:write`** — semantically wrong for
  health tracking, and it would have let a provider who can read a patient's progress also
  edit their account. Now `progress:read` / `progress:write`, seeded to `user` (both) and
  `provider` (read only).
- **`goals` was missing from GDPR erasure entirely** — 10 tables were deleted, not 11.
- **`GET /users/me` returned an arbitrary profile's onboarding row** once several profiles
  existed, because it filtered on `user_id` with `LIMIT 1`. Pinned to the self profile.
- **GDPR export returned one profile's onboarding state and silently dropped the rest.**
- **Audit rows on collection routes carried `profile_id = NULL`** — the column an access
  review filters on.
- **`users.phone_hash` held plaintext too**, the same defect as the profile column.
- **Five progress routes had no request-body schema.**
- **`habit_checkins` had no `profile_id`**, so its scoping went through an unindexed
  `IN (...)` over the profile's habits.

## Found by the test suites and the documentation pass

The tests were written to prove the fixes above stayed fixed. They found six more real
defects, two of them regressions introduced by those very fixes — which is the argument for
writing them.

| Defect | Origin |
|---|---|
| Order creation completely unreachable: the route schemas added for R5 were guessed rather than read from the controllers, so Zod stripped `providerId` and `items` and every `POST /payments/orders`, `/checkout` and `/orders/:id/pay` returned 400 | **regression from the R5 fix** |
| The login rate limiter governed the entire auth API — `.use(loginRateLimit)` mid-chain with a `{ as: 'scoped' }` hook propagates to every route declared after it, so six calls to `/auth/sessions` returned 429. Behind the gateway, where NATed clients share an `X-Forwarded-For`, that is a self-inflicted denial of service | **regression from the R10 fix** |
| `createBookingSchema` accepted `sessionType` values the `session_type` enum cannot store, so a valid-looking request passed validation and crashed the insert with a 500 | pre-existing drift |
| `POST /auth/google` with no body returned 500 — the handler read a field off `undefined` and the route had no schema | pre-existing |
| The gateway's public spec advertised nine `/api/v1/internal/*` paths, including GDPR erasure — a map of the internal surface, for routes that answer 404 | pre-existing |
| `onboarding_state` still carried its account-wide unique constraint, so a second profile's first intake returned 500 | dev database built by `db:push`, migrations never recorded |

All six are fixed. The last one exposed a further problem: the dev database had **zero**
rows in `drizzle.__drizzle_migrations`, so `drizzle-kit migrate` tried to replay `0000` and
died on an existing enum. `scripts/baseline-migrations.ts` records each migration's hash the
way drizzle's own migrator computes it; migrate is now a clean no-op there, and the
from-empty path was verified separately.

The documentation pass over the admin, provider and marketplace routes turned up 24 more
issues, six of them security-relevant (raw ciphertext and a keyed lookup hash in an admin
response; super_admin locked out of every `/admin/*` route; a dormant SQL-injection sink;
saved items invisible to GDPR export and surviving erasure; four admin routes answering 500
instead of 400 on a missing body; `/providers/:id/slots` 500 on a missing date). Those are
being fixed. The remainder — parameters accepted and silently ignored, summaries that
described behaviour the handler does not have — are recorded in the route documentation
itself, which now describes what the code does rather than what it was meant to do.

## Left open, deliberately

- **The service connects to Postgres as a superuser** (`longeny`, `rolsuper = t`). The
  append-only trigger stops the application and an ad-hoc `UPDATE`; it cannot stop a
  superuser. A least-privilege role is an infrastructure change and belongs with Milan.
- **`user_id` means two different things.** On the progress and onboarding tables it holds
  the JWT `auth_id`; elsewhere it is a `users.id` foreign key. The backfill matches both.
  Unifying them is part of the D2 card and needs its own migration.
- **`health_profiles` has no `profile_id` column**, so an AI intake run for a dependent
  still overwrites the account owner's clinical record. Schema change, Week 7.
- **452 `noExplicitAny` warnings** remain in controllers not touched by this work.
- **OAuth still binds Google to an existing password account** without asking for the
  password, once `email_verified` and an active status are confirmed. Requiring an
  authenticated link step is the stronger control and is a product decision.
- **Two audit rows per role change** — the controller's pre-existing row and the service's
  new one. Harmless, worth collapsing when someone owns that controller.
- **A dev box running `NODE_ENV=development` still seeds the published passwords.** Set
  `SEED_ADMIN_PASSWORD` / `SEED_SUPER_ADMIN_PASSWORD` there, or move it to `staging`.
