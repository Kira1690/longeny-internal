# LONGENY — Frontend Developer Documentation

## Quick Links

| Resource | URL |
|----------|-----|
| **Swagger UI — Gateway (everything a client can call)** | [http://localhost:3000/docs](http://localhost:3000/docs) |
| Swagger JSON — Gateway | [http://localhost:3000/docs/json](http://localhost:3000/docs/json) |
| Swagger UI — auth-service | [http://localhost:3001/docs](http://localhost:3001/docs) |
| Swagger UI — user-provider-service | [http://localhost:3002/docs](http://localhost:3002/docs) |
| Swagger UI — booking-service | [http://localhost:3003/docs](http://localhost:3003/docs) |
| Swagger UI — payment-service | [http://localhost:3005/docs](http://localhost:3005/docs) |
| Swagger UI — ai-content-service | [http://localhost:3004/docs](http://localhost:3004/docs) |
| Health check (aggregated) | [http://localhost:3000/health](http://localhost:3000/health) |

**Start at the gateway spec.** It merges every service into one document with the
`/api/v1` prefix a client actually calls, and it deliberately omits the `/internal/*`
routes — those are HMAC-signed service-to-service calls that answer 404 through the
gateway. A per-service spec is the right place to look when you are debugging that
service directly.

Every request body renders as a real JSON Schema; if you ever see `_def` or `ZodNever`
in a spec, that route bypassed the `documented()` helper — report it rather than coding
against it.

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| 00 | [Getting Started](./00-getting-started.md) | Setup, install, run locally, ports, test accounts |
| 01 | [Auth API Reference](./01-auth-api-reference.md) | Every endpoint — request/response, codes, examples |
| 02 | [JWT & Token Guide](./02-jwt-token-guide.md) | Token structure, decode, refresh flow, permissions, React interceptor |
| 03 | [Error Handling](./03-error-handling.md) | Error formats, codes, validation errors, handler example |
| 04 | [Frontend Integration](./04-frontend-integration-examples.md) | AuthContext, login/register pages, protected routes, consent banner |
| 05 | [AI Content Service](./05-ai-content-service.md) | Onboarding, KB upload, RAG query — endpoints, auth, error codes, env vars |
| 06 | [Onboarding Persistence & Greeting](./06-onboarding-persistence-and-greeting.md) | Onboarding data persisted to the profile; Aria greets by name; `GET /users/me` new fields |
| 07 | [Multi-Profile / Family (RRO) API](./07-profiles-rro-api.md) | Account→profiles tenancy, ownership guard, caregiver consent, RRO state, parent notifications |
| 08 | [RRO API Testing Guide](./08-profiles-rro-api-testing.md) | Run every Profiles/RRO endpoint locally — setup, curl per endpoint, HMAC signing, negative tests, one-shot suite |
| 09 | [Permissions, Roles & Profile Context](./09-auth-permissions-and-profile-context.md) | What the token carries, 403 vs 404, acting as a family profile via `X-Active-Profile-Id`, rate limits |
| 10 | [Intake, AI Results & Report Timeline](./10-intake-reports-and-rro-ai.md) | Submitting intake, reading the RRO classification and pre-consult summary, the report timeline, calendar invites for dependents |

## Auth Service — Endpoint Summary

### Public (no token needed)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login (rate limited: 5/15min) |
| POST | `/auth/refresh` | Refresh tokens |
| POST | `/auth/logout` | Logout |
| POST | `/auth/google` | Google OAuth |
| POST | `/auth/verify-email` | Verify email token |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset with token |
| POST | `/auth/verify-token` | Check if token is valid |

### Authenticated (Bearer token required)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/logout-all` | Revoke all sessions |
| POST | `/auth/change-password` | Change password |
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions/:id` | Revoke a session |
| GET | `/auth/consents` | List GDPR consents |
| POST | `/auth/consents` | Grant consent |
| DELETE | `/auth/consents/:type` | Revoke consent |

### Admin only (admin role required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/audit-log` | Query audit trail |
| GET | `/auth/roles` | List roles |
| POST | `/auth/roles` | Create role |
| GET | `/auth/roles/:id/permissions` | Get role permissions |
| PUT | `/auth/roles/:id/permissions` | Update role permissions (**super_admin only**) |
| GET | `/auth/users/:userId/roles` | Get user roles |
| PUT | `/auth/users/:userId/roles` | Assign roles |

## Test Accounts

| Email | Password | Role |
|-------|----------|------|
| `admin@longeny.com` | `Admin123!@#` | admin |
| `superadmin@longeny.com` | `SuperAdmin123!@#` | super_admin |

These accounts are seeded **only when `NODE_ENV` is `development` or `test`**. Any other
environment seeds roles and permissions but no credentials. Set `SEED_ADMIN_PASSWORD` and
`SEED_SUPER_ADMIN_PASSWORD` (12+ characters) to override the development defaults — a
shared dev box should use them rather than the published literals.

Create new accounts via `POST /auth/register`.

## Architecture

```
Frontend (React/Next.js)
    │
    ▼
┌─────────────────┐     ┌──────────────────┐
│  Auth Service    │────>│  PostgreSQL 16   │
│  :3011           │     │  longeny_auth    │
│                  │────>│                  │
│  Elysia + Bun   │     └──────────────────┘
│  JWT + bcrypt    │     ┌──────────────────┐
│  Drizzle ORM    │────>│  Redis 7         │
│                  │     │  Token blacklist  │
└─────────────────┘     │  Rate limiting    │
                        └──────────────────┘
```
