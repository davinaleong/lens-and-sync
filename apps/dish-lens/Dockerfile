FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable
# sharp needs libvips at runtime; node:20-slim + sharp's prebuilt binaries cover this on linux/amd64 & arm64
# Prisma's engine binaries need OpenSSL - node:20-slim doesn't ship it, which
# makes Prisma fail to detect the libssl version and then try (and fail, as
# the non-root `node` user) to fetch a differently-linked engine at runtime.
# Installing it here, before `pnpm install` first fetches the engines, means
# the correctly-linked one is fetched once and no runtime write is needed.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/dish-lens/package.json apps/dish-lens/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @lens-and-sync/dish-lens...

FROM deps AS build
COPY apps/dish-lens apps/dish-lens
RUN pnpm --filter @lens-and-sync/dish-lens... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
# All shared-* packages, not just shared-db - node_modules/@lens-and-sync/*
# symlinks (copied below) point into here, and dish-lens imports from
# several of them (shared-auth, shared-config, shared-logger, shared-utils),
# not just shared-db.
COPY --from=build /app/packages packages
COPY --from=build /app/apps/dish-lens/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
# runs pending Prisma migrations against DATABASE_URL before the server starts —
# migrate:deploy is idempotent, so this is safe on every deploy/restart
CMD ["sh", "-c", "pnpm --filter @lens-and-sync/shared-db run migrate:deploy && node dist/index.js"]
