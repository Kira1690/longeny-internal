# LONGENY — Frontend Developer Documentation

## Quick Links

| Resource | URL |
|----------|-----|
| Swagger UI | [http://localhost:3011/swagger](http://localhost:3011/swagger) |
| Swagger JSON | [http://localhost:3011/swagger/json](http://localhost:3011/swagger/json) |
| Health Check | [http://localhost:3011/health](http://localhost:3011/health) |

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| 00 | [Getting Started](./00-getting-started.md) | Setup, install, run locally, ports, test accounts |
| 01 | [Auth API Reference](./01-auth-api-reference.md) | Every endpoint — request/response, codes, examples |
| 02 | [JWT & Token Guide](./02-jwt-token-guide.md) | Token structure, decode, refresh flow, permissions, React interceptor |
| 03 | [Error Handling](./03-error-handling.md) | Error formats, codes, validation errors, handler example |
| 04 | [Frontend Integration](./04-frontend-integration-examples.md) | AuthContext, login/register pages, protected routes, consent banner |
| 05 | [AI Content Service](./05-ai-content-service.md) | Onboarding, KB upload, RAG query — endpoints, auth, error codes, env vars |

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
| PUT | `/auth/roles/:id/permissions` | Update role permissions |
| GET | `/auth/users/:userId/roles` | Get user roles |
| PUT | `/auth/users/:userId/roles` | Assign roles |

## Test Accounts

| Email | Password | Role |
|-------|----------|------|
| `admin@longeny.com` | `Admin123!@#` | admin |

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
