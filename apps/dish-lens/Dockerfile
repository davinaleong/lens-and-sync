FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable
# sharp needs libvips at runtime; node:20-slim + sharp's prebuilt binaries cover this on linux/amd64 & arm64

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
COPY --from=build /app/packages/shared-db packages/shared-db
COPY --from=build /app/apps/dish-lens/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
# runs pending Prisma migrations against DATABASE_URL before the server starts —
# migrate:deploy is idempotent, so this is safe on every deploy/restart
CMD ["sh", "-c", "pnpm --filter @lens-and-sync/shared-db run migrate:deploy && node dist/index.js"]
