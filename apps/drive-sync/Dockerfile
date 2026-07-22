FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/drive-sync/package.json apps/drive-sync/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @lens-and-sync/drive-sync...

FROM deps AS build
COPY apps/drive-sync apps/drive-sync
RUN pnpm --filter @lens-and-sync/drive-sync run build

FROM base AS runtime
ENV NODE_ENV=production
USER node
COPY --from=build /app/apps/drive-sync/dist ./dist
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
