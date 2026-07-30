# Deployment Guide — Lens and Sync

Covers local development, production Docker builds, database migrations, and environment configuration for both `drive-sync` and `dish-lens`.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 9.12.0 (enforced via `packageManager`) |
| Docker & Docker Compose | any recent stable |
| PostgreSQL | 16 (provided via Docker in local dev) |
| Redis | 7 (provided via Docker in local dev) |

Enable corepack so pnpm is available without a separate install:

```bash
corepack enable
```

---

## External services

Both apps require credentials for third-party services provisioned before deployment.

| Service | Used by | Purpose |
|---|---|---|
| PostgreSQL | both | persistent storage |
| Redis | both | session state & job queue |
| Pinecone | drive-sync | vector store |
| OpenAI | drive-sync | text embeddings |
| Google Service Account (Drive) | drive-sync | Drive API + read access |
| Google Cloud Project (Vision + GCS) | dish-lens | Vision API + image storage |
| Anthropic Claude | dish-lens | recipe generation |
| Nutritionix (or equivalent) | dish-lens | nutrition lookup |

---

## Environment variables

Each app reads its `.env` at startup and validates every required key via Zod. Copy the example file and fill in real values before running anything.

```bash
cp apps/drive-sync/.env.example  apps/drive-sync/.env
cp apps/dish-lens/.env.example   apps/dish-lens/.env
```

Run the env check at any time to see what is missing:

```bash
# from repo root, with .env already sourced by Docker or dotenv
node apps/drive-sync/scripts/check-env.mjs
node apps/dish-lens/scripts/check-env.mjs
```

### drive-sync env reference

```
PORT=4001
NODE_ENV=production
LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=https://your-frontend.example.com

JWT_ACCESS_SECRET=<min 32 chars>
JWT_REFRESH_SECRET=<min 32 chars>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account>@<project>.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/run/secrets/google-sa-key.json
GOOGLE_DRIVE_FOLDER_IDS=<folder-id-1>,<folder-id-2>

PINECONE_API_KEY=<key>
PINECONE_INDEX_NAME=<index>
PINECONE_NAMESPACE=<namespace>

OPENAI_API_KEY=<key>
EMBEDDING_MODEL=text-embedding-3-small
# EMBEDDING_DIMENSIONS=1536   # only set if index was created with a non-default dim

DATABASE_URL=postgresql://postgres:postgres@postgres:5432/lens_and_sync
REDIS_URL=redis://redis:6379

SYNC_QUEUE_NAME=drive-sync-queue
SYNC_CRON_SCHEDULE=0 */6 * * *
```

### dish-lens env reference

```
PORT=4002
NODE_ENV=production
LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=https://your-frontend.example.com

JWT_ACCESS_SECRET=<same secret as drive-sync if sharing auth>
JWT_REFRESH_SECRET=<same secret as drive-sync if sharing auth>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

GOOGLE_CLOUD_PROJECT_ID=<project-id>
GOOGLE_CLOUD_CREDENTIALS_JSON=<inline JSON string or path — see note below>

ANTHROPIC_API_KEY=<key>
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

NUTRITION_API_PROVIDER=nutritionix
NUTRITION_API_APP_ID=<app-id>
NUTRITION_API_APP_KEY=<key>

GCS_BUCKET_NAME=<bucket>
GCS_SIGNED_URL_EXPIRY_SECONDS=3600

REDIS_URL=redis://redis:6379
REDIS_SESSION_TTL_SECONDS=1800

DATABASE_URL=postgresql://postgres:postgres@postgres:5432/lens_and_sync

MAX_UPLOAD_SIZE_MB=10
MAX_IMAGE_DIMENSION_PX=4096
BLUR_VARIANCE_THRESHOLD=100

DISH_CONFIDENCE_THRESHOLD=0.6
FOOD_EVIDENCE_THRESHOLD=0.5

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
UPLOAD_RATE_LIMIT_WINDOW_MS=60000
UPLOAD_RATE_LIMIT_MAX_UPLOADS=20
```

> **Google credentials note:** `GOOGLE_CLOUD_CREDENTIALS_JSON` expects either the full JSON string (escaped to one line) or a file path depending on how the app loads it. Check `apps/dish-lens/src/config.ts` to confirm the expected format before deploying.

---

## Local development

Starts Postgres, Redis, and both APIs with hot-reload:

```bash
# install workspace deps
pnpm install

# run all services via Docker Compose (Postgres + Redis only — apps run from source)
docker compose -f infra/docker-compose.yml up postgres redis -d

# run migrations against the local DB
pnpm db:migrate

# start both APIs in watch mode via Turborepo
pnpm dev
```

To run the full stack in Docker (apps included):

```bash
docker compose -f infra/docker-compose.yml up --build
```

Services will be available at:

- `drive-sync` → http://localhost:4001
- `dish-lens`  → http://localhost:4002

---

## Database migrations

Migrations are managed by Prisma inside `packages/shared-db`.

```bash
# development — generates a new migration and applies it
pnpm db:migrate

# production / CI — applies pending migrations only, never generates new ones
pnpm --filter @lens-and-sync/shared-db run migrate:deploy
```

Always run `migrate:deploy` before starting the app containers in production. The recommended order is:

1. Run `migrate:deploy` as an init container or pre-start hook.
2. Start `drive-sync` and `dish-lens`.

---

## Production Docker build

Both apps use multi-stage Dockerfiles rooted at the monorepo root. Build from the repo root so the build context includes the shared packages.

```bash
# drive-sync
docker build \
  -f apps/drive-sync/Dockerfile \
  -t lens-and-sync/drive-sync:latest \
  .

# dish-lens
docker build \
  -f apps/dish-lens/Dockerfile \
  -t lens-and-sync/dish-lens:latest \
  .
```

Both images:
- base: `node:20-slim`
- run as the unprivileged `node` user
- set `NODE_ENV=production`
- expect all env vars injected at runtime (not baked in)

---

## Production environment checklist

Before going live:

- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are cryptographically random (≥ 32 chars), not shared publicly.
- [ ] `DATABASE_URL` points to a managed Postgres instance with TLS enabled (`?sslmode=require`).
- [ ] `REDIS_URL` points to a managed Redis instance with auth (`redis://:password@host:6379`).
- [ ] Google Service Account key file is mounted as a secret (not baked into the image).
- [ ] Pinecone index dimension matches `EMBEDDING_DIMENSIONS` (or the model default if omitted).
- [ ] GCS bucket has appropriate IAM bindings for the dish-lens service account.
- [ ] `CORS_ALLOWED_ORIGINS` is set to your actual frontend origin(s), not `*`.
- [ ] `NODE_ENV=production` is set in both containers.
- [ ] `migrate:deploy` runs before app startup on every release.

---

## Build and test pipeline

Run the full build + test suite locally before pushing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Turborepo caches task outputs across packages. Only changed packages and their dependents are rebuilt.

---

## Ports summary

| Container | Internal port | Exposed (local dev) |
|---|---|---|
| `drive-sync` | 4001 | 4001 |
| `dish-lens` | 4002 | 4002 |
| `postgres` | 5432 | 5432 |
| `redis` | 6379 | 6379 |

In production, only the API ports should be exposed through a reverse proxy or load balancer. Postgres and Redis should not be publicly accessible.
