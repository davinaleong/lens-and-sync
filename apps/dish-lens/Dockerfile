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
# pnpm gives every app/package its own local node_modules full of symlinks
# back into the root .pnpm store (not just a single hoisted root
# node_modules) - dish-lens's own node_modules/@lens-and-sync/* AND
# node_modules/express etc, plus packages/shared-db's own node_modules for
# `prisma` (needed by migrate:deploy below), are just as required as the
# root node_modules/.pnpm store they point into. Copying the whole build
# output wholesale, preserving the exact structure that successfully
# built, avoids re-discovering which specific subdirectory is missing.
COPY --from=build /app /app
USER node
# runs pending Prisma migrations against DATABASE_URL before the server starts —
# migrate:deploy is idempotent, so this is safe on every deploy/restart
CMD ["sh", "-c", "pnpm --filter @lens-and-sync/shared-db run migrate:deploy && node apps/dish-lens/dist/index.js"]
