# Permissions, Roles & Profile Context

What changed for the frontend: the access token now carries **roles and permissions**, and
every profile-scoped request can name **which profile it is acting as**.

---

## 1. What the token contains

`POST /auth/login`, `/auth/register`, `/auth/refresh` and `/auth/google` all return an
access token whose payload now looks like this:

```json
{
  "sub": "22222222-2222-2222-2222-222222222222",
  "email": "vishal@example.com",
  "role": "user",
  "roles": ["user"],
  "permissions": [
    "profiles:read", "profiles:write", "consent:grant", "rro:read",
    "progress:read", "progress:write",
    "users:read", "users:write",
    "bookings:read", "bookings:write", "bookings:cancel",
    "payments:read", "payments:write",
    "documents:read", "documents:write", "documents:share"
  ],
  "jti": "…",
  "iat": 1787000000,
  "exp": 1787000900
}
```

- `role` — the highest-privilege role. Still there; safe to keep reading.
- `roles` — **every** role held. A user who is both a patient and a provider now keeps both;
  previously only the first row won.
- `permissions` — what the UI may offer. Use this to decide which buttons to render.

Decoding is client-side only. The server re-checks on every request; a token edited in the
browser fails signature verification.

### Permissions by role

| Role | Notable permissions |
|---|---|
| `user` | `profiles:read`, `profiles:write`, `consent:grant`, `rro:read`, `progress:read`, `progress:write`, bookings, payments (not refunds), documents |
| `provider` | `profiles:read`, `rro:read`, `rro:write`, `progress:read` (not write), `providers:write`, bookings, `payments:read`, documents |
| `admin` / `super_admin` | everything, including `payments:refund` and the `admin:*` set |

Permissions come from `role_permissions` in the database and land in the token at login.
**Granting a permission takes effect on the user's next token refresh.** Taking one away is
immediate where it matters: a role change, a password change and a password reset all revoke
that user's outstanding tokens, so a demotion does not last until their access token
expires. Expect a `401 TOKEN_REVOKED` after any of those and send the user back to login.

---

## 2. Response codes you will see

| Code | Meaning | What the UI should do |
|---|---|---|
| 401 `UNAUTHORIZED` | No token, or it is invalid/expired | Send to login, or refresh |
| 401 `TOKEN_REVOKED` | Logged out on this or another device | Send to login |
| 403 `FORBIDDEN` | Authenticated, but the token lacks a required role or permission. The message names it: `Requires permission: profiles:write` | Do not retry; hide the action |
| 404 `NOT_FOUND` | The resource does not exist **or** belongs to another account | Treat as "not found". The two are deliberately indistinguishable, so never infer existence from this |
| 429 | Rate limit; `X-RateLimit-Reset` says when it clears | Back off, show the reset time |
| 503 `REVOCATION_CHECK_UNAVAILABLE` | The server could not verify whether the token was revoked | Retry shortly. This is a transient server-side condition on health-data routes |

A 403 never means "wrong owner" — that is always a 404. This holds across profiles,
progress data, bookings, orders and refunds: a resource that exists but belongs to someone
else answers exactly like one that does not exist, byte for byte, so a client can never use
the response to learn that an id is real.

---

## 3. Acting as a family profile

One account owns many profiles: the account owner (`is_self: true`) plus dependents such as
a parent, who have **no login of their own**.

### Switching

```http
POST /api/v1/profiles/:id/activate
Authorization: Bearer <token>
```

Returns the profile and its RRO state, and proves the account owns it.

### Then send the header

```http
GET /api/v1/progress/dashboard
Authorization: Bearer <token>
X-Active-Profile-Id: fbb69b7c-3a46-4105-a230-9f0586151d54
```

- **Omit the header** and the request acts as the account owner's own profile. A
  single-profile client needs no changes at all.
- **Send a profile the account does not own** and the response is `404`, not `403`.
- The header is re-verified on **every** request. Activating once is not a session; there is
  no server-side "current profile" to fall out of sync with.

Store the active profile id in client state (or the URL) and send it on every call while
that profile is selected.

### Which routes read it

| Surface | Reads `X-Active-Profile-Id` |
|---|---|
| `/profiles/*` | No — the profile is in the path |
| `/progress/*` | Yes — entries, habits, goals and check-ins all belong to the acting profile |
| `/users/me/onboarding` | Yes — intake is about a subject of care |
| Bookings, payments, AI | Not yet — being added with the features that need them |

Data written while acting as one profile is invisible to every other profile, including the
account owner's own. Two family members under one account do not share a pool.

---

## 4. Gateway paths

Profiles are reachable through the gateway under `/api/v1/profiles`. Internal service
routes (`/internal/*`) are **not** exposed and never will be — they are HMAC-signed
service-to-service calls.

---

## 5. Auditing (what you should know)

Every request to a health-data route is recorded server-side — who, which profile, which
route, what the response was — **including refused ones**. Nothing is required of the
client. It does mean a UI should not poll health-data endpoints in a tight loop: each call
is a permanent row in an access log a compliance reviewer reads.

---

## 6. Rate limits

| Surface | Limit | Keyed by |
|---|---|---|
| `/profiles/*` | 120 requests / minute | Account |
| `/auth/login` | 5 / 15 minutes | IP |
| Everything through the gateway | Configured global limit | IP |

Profile limits are per **account**, so several family members on one network do not share a
budget. Read `X-RateLimit-Remaining` and `X-RateLimit-Reset` from any response.
