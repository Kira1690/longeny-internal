FROM oven/bun:1 AS base
WORKDIR /app

# ── Install dependencies ──
FROM base AS install
COPY package.json bun.lockb ./
COPY packages/ ./packages/
COPY apps/gateway/package.json ./apps/gateway/
RUN bun install --frozen-lockfile

# ── Release ──
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages ./packages
COPY apps/gateway/ ./apps/gateway/
WORKDIR /app/apps/gateway

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
