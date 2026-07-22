FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable
# sharp needs libvips at runtime; node:20-slim + sharp's prebuilt binaries cover this on linux/amd64 & arm64

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/dish-lens/package.json apps/dish-lens/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @lens-and-sync/dish-lens...

FROM deps AS build
COPY apps/dish-lens apps/dish-lens
RUN pnpm --filter @lens-and-sync/dish-lens run build

FROM base AS runtime
ENV NODE_ENV=production
USER node
COPY --from=build /app/apps/dish-lens/dist ./dist
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
