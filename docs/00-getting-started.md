# Getting Started — Frontend Developer Guide

## Prerequisites

- **Bun** v1.1.38+ — [install](https://bun.sh)
- **Docker** — for PostgreSQL and Redis
- **Git** — access to the monorepo

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Kira1690/longeny-internal.git
cd longeny-internal

# 2. Install dependencies
bun install

# 3. Copy environment config
cp .env.example .env
# Edit .env — update ports if 5432/6379 are in use

# 4. Start database and cache
docker run -d --name longeny-postgres \
  -e POSTGRES_USER=longeny \
  -e POSTGRES_PASSWORD=longeny_dev_password \
  -e POSTGRES_DB=longeny_auth \
  -p 5434:5432 \
  -v $(pwd)/infrastructure/docker/init-databases.sql:/docker-entrypoint-initdb.d/01-init.sql \
  pgvector/pgvector:pg16

docker run -d --name longeny-redis \
  -p 6380:6379 \
  redis:7-alpine redis-server --maxmemory 256mb

# 5. Wait for postgres to be ready (~5 seconds), then push schema + seed
cd apps/auth-service
AUTH_DATABASE_URL=postgresql://longeny:longeny_dev_password@localhost:5434/longeny_auth \
  bunx drizzle-kit push
AUTH_DATABASE_URL=postgresql://longeny:longeny_dev_password@localhost:5434/longeny_auth \
  bun run src/db/seed.ts

# 6. Start the auth service
cd ../..
AUTH_SERVICE_PORT=3011 \
AUTH_DATABASE_URL=postgresql://longeny:longeny_dev_password@localhost:5434/longeny_auth \
JWT_ACCESS_SECRET=$(openssl rand -hex 48) \
JWT_REFRESH_SECRET=$(openssl rand -hex 48) \
REDIS_HOST=localhost \
REDIS_PORT=6380 \
HMAC_SECRET=$(openssl rand -hex 32) \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
bun run apps/auth-service/src/index.ts

# 7. Verify
curl http://localhost:3011/health
# → {"status":"ok","service":"auth-service","timestamp":"..."}
```

## Service Ports

| Service | Port | Status |
|---------|------|--------|
| Auth Service | 3011 | Ready |
| Gateway | 3000 | Coming soon |
| User & Provider | 3002 | Coming soon |
| Booking | 3003 | Coming soon |
| AI & Content | 3004 | Coming soon |
| Payment | 3005 | Coming soon |

## Seeded Test Accounts

| Email | Password | Role |
|-------|----------|------|
| `admin@longeny.com` | `Admin123!@#` | admin |

Register new user/provider accounts via `POST /auth/register`.

## Swagger / API Documentation

Elysia has built-in Swagger support. Once enabled, access it at:

```
http://localhost:3011/swagger
```

To enable it, add to `apps/auth-service/src/app.ts`:

```typescript
import { swagger } from '@elysiajs/swagger';

const app = new Elysia()
  .use(swagger({
    documentation: {
      info: { title: 'LONGENY Auth Service', version: '1.0.0' },
      tags: [
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'RBAC', description: 'Role & permission management' },
      ],
    },
  }))
  // ... rest of middleware
```

Install the plugin:
```bash
bun add @elysiajs/swagger
```

## CORS

The auth service allows requests from `http://localhost:5173` (Vite default). Configure `CORS_ORIGIN` in `.env` if your frontend runs on a different port.

## Base URL for Frontend

All auth endpoints use the base URL:

```
http://localhost:3011
```

No `/api/v1` prefix — routes are mounted directly (e.g., `/auth/register`, `/auth/login`).

When the gateway is live, use `http://localhost:3000/api/v1/auth/*` instead.
