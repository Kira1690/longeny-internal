FROM oven/bun:1 AS base
WORKDIR /app

# ── Install dependencies ──
FROM base AS install
COPY package.json bun.lockb ./
COPY packages/ ./packages/
COPY apps/user-provider-service/package.json ./apps/user-provider-service/
RUN bun install --frozen-lockfile

# ── Build ──
FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages ./packages
COPY apps/user-provider-service/ ./apps/user-provider-service/
WORKDIR /app/apps/user-provider-service
RUN bunx prisma generate

# ── Release ──
FROM base AS release
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/user-provider-service ./apps/user-provider-service
WORKDIR /app/apps/user-provider-service

ENV NODE_ENV=production
EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
