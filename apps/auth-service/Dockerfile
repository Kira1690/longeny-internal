FROM oven/bun:1 AS base
WORKDIR /app

# ── Install dependencies ──
FROM base AS install
COPY package.json bun.lockb ./
COPY packages/ ./packages/
COPY apps/auth-service/package.json ./apps/auth-service/
RUN bun install --frozen-lockfile

# ── Build ──
FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages ./packages
COPY apps/auth-service/ ./apps/auth-service/
WORKDIR /app/apps/auth-service
RUN bunx prisma generate

# ── Release ──
FROM base AS release
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/auth-service ./apps/auth-service
WORKDIR /app/apps/auth-service

ENV NODE_ENV=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
