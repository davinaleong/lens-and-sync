# Progress — 2026-07-22

Scope for today (agreed ~10:20am SGT, target 5:15pm SGT): the full spec across
`01`–`04` (two production APIs with real Pinecone/Vision/Redis/Postgres
integrations, iOS client, full security hardening, full test suites) is
multiple weeks of work, not a same-day task. Today's slice was narrowed to
**monorepo structure + Prisma schema only** — no business logic, no live
external service calls (no credentials exist for Pinecone/Vision/Drive
regardless).

## Decisions locked in

- Workspace tooling: **pnpm + Turborepo** (the doc's proposed default,
  resolving the open decision in `03-monorepo-structure.md`).
- External services (Pinecone, Redis, Postgres, Google Vision, Google Drive):
  folder structure + `.env.example` keys only. No SDK calls wired up yet.

## What's done

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`. `pnpm install` run, lockfile committed.
- `apps/drive-sync` — full folder structure from `03-monorepo-structure.md`
  (`auth/`, `drive/`, `extraction/`, `chunking/`, `embeddings/`,
  `vector-store/`, `retrieval/`, `jobs/`, `routes/`), each file a `TODO`
  stub. Minimal Express app with `/health` — boots and responds.
- `apps/dish-lens` — same treatment (`upload/`, `preprocessing/`, `vision/`,
  `edge-cases/`, `recipe/`, `nutrition/`, `session/`, `history/`,
  `moderation/`, `routes/`). Minimal Express app with `/health` — boots and
  responds.
- `packages/shared-db` — real Prisma schema: `User`, `RefreshToken`,
  `DriveFile` (per the fields listed in `02-milestones-checklist.md` #8:
  `driveFileId`, `contentHash`, `driveModifiedTime`, `chunkIds`,
  `lastSyncedAt`), `SavedChat` (JSONB `messages`, write-once by convention —
  no update path exposed). `prisma generate` runs clean.
- `packages/shared-types`, `shared-config`, `shared-logger`, `shared-auth`,
  `shared-utils` — package skeletons, each with a `TODO` stub describing its
  eventual contents per the monorepo doc.
- `infra/docker-compose.yml` (Postgres + Redis + both apps),
  `infra/terraform/` and `infra/ci/` placeholders.
- `.github/workflows/ci.yml` — install, prisma generate, lint, typecheck,
  test, build, against Postgres + Redis service containers. Not yet run on
  a real PR.
- `.env.example` at root and per-app, keys derived from
  `01-security-checklist.md` (JWT secrets, Pinecone, Google Vision creds,
  Redis URL, object storage, rate-limit config, etc.) and
  `02-milestones-checklist.md`.
- Verified: `pnpm run typecheck` and `pnpm run build` pass clean across all
  9 workspace packages; both apps boot and serve `/health` locally.

## Explicitly not done (out of scope for today)

- Any business logic: change detection, chunking, embeddings, Pinecone
  reads/writes, blur detection math, Vision integration, recipe/nutrition
  generation, Redis session store, save-chat immutability enforcement.
- All of `01-security-checklist.md` beyond folder/env scaffolding (no auth
  middleware, no rate limiting, no input validation wired up).
- All of `04-testing-checklist.md` (no tests written — `vitest` is wired
  into `package.json` scripts and CI, but there's nothing to run yet).
- iOS client — not started.
- Real docker-compose run against the two app containers (untested; local
  Dockerfiles are written but not built).
- Terraform/cloud infra — placeholder folder only.

## Suggested next session

1. Pick one app (DishLens is the more self-contained slice) and implement
   one full vertical path — e.g. blur detection + file-type validation,
   since both are pure functions that don't need live credentials to write
   or unit-test.
2. ~~Wire `shared-config`'s zod env schema so both apps fail fast on
   missing env vars.~~ Loader built (`loadEnv`, tested) — see
   `07-implementation-log.md` Cycle 1. Still needs wiring into each app's
   `index.ts` — that's `07-implementation-log.md` Cycle 2.
3. Get real Pinecone/Vision/Google OAuth credentials into a `.env` (not
   committed) before attempting any live-integration work.

See `07-implementation-log.md` for the ongoing implementation cycle log.
