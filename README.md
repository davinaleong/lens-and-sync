# Lens and Sync

A pnpm monorepo containing two Node.js/TypeScript services — **DishLens** and **DriveSync** — backed by shared packages for auth, config, database, logging, and utilities.

## Services

### dish-lens (port 4002)

Photo-to-recipe API for food analysis.

- Upload a dish photo → Google Vision detects the dish and runs NSFW moderation
- Anthropic Claude generates a recipe from the identified dish
- Edamam API looks up nutritional data
- Photos stored in Google Cloud Storage; metadata in Postgres
- Chat history persisted per user (Redis for live sessions, Postgres for saved chats)
- Password-based auth (bcrypt) with rotating JWT access + refresh tokens
- Email verification, OTP login, and password reset via Mailtrap
- Meal planning (create plans, schedule dishes by date and meal type)

**Routes:** `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/verify-email` · `POST /auth/resend-verification` · `POST /auth/send-otp` · `POST /auth/verify-otp` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /upload` · `GET /chats` · `GET /chats/:id` · `POST /meal-plans` · `GET /meal-plans` · `GET /meal-plans/:id` · `DELETE /meal-plans/:id` · `POST /meal-plans/:id/entries` · `DELETE /meal-plans/:id/entries/:entryId`

### drive-sync (port 4001)

Google Drive → Pinecone sync worker with a RAG retrieval endpoint.

- BullMQ cron job periodically lists configured Drive folders
- Changed/new files are extracted, chunked, embedded (OpenAI), and upserted into Pinecone
- Content-hash dedup skips re-embedding unchanged files
- Redis-backed distributed lock prevents overlapping sync runs
- `GET /sync/audit` returns a full index snapshot (files tracked, chunk counts, last sync result)

**Routes:** `POST /sync/query` · `GET /sync/status` · `GET /sync/audit`

## Shared packages

| Package         | Purpose                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `shared-auth`   | JWT sign/verify, `requireAuth` middleware                                                                 |
| `shared-config` | `loadEnv` + Zod schema helpers (`commaSeparated`, `jsonObject`, …)                                        |
| `shared-db`     | Prisma client + schema (User, RefreshToken, VerificationToken, DriveFile, SavedChat, MealPlan, MealEntry) |
| `shared-logger` | Pino logger factory + security event helpers                                                              |
| `shared-types`  | Cross-service TypeScript types                                                                            |
| `shared-utils`  | Express middleware (HTTPS redirect, 404, error handler)                                                   |

## Stack

TypeScript · Node.js 20 · Express · Prisma (Postgres) · Redis · BullMQ · Pinecone · OpenAI · Anthropic Claude · Google Cloud Vision · Google Cloud Storage · Google Drive API · Mailtrap · Zod · Vitest · Turbo · pnpm workspaces

## Local development

```sh
# Start Postgres and Redis
docker compose -f infra/docker-compose.yml up -d postgres redis

# Install dependencies
pnpm install

# Apply DB migrations
pnpm db:migrate

# Run both services in watch mode
pnpm dev
```

Copy `apps/dish-lens/.env.example` → `apps/dish-lens/.env` and `apps/drive-sync/.env.example` → `apps/drive-sync/.env` and fill in all values before starting.

## Useful commands

```sh
pnpm build          # Compile all packages and apps (Turbo)
pnpm test           # Run all test suites
pnpm typecheck      # Type-check all packages
pnpm db:migrate     # Create and apply a new Prisma migration (dev)
```

## Deployment

Both services are deployed on Railway. The `dish-lens` Railway Build Command must include the migration step:

```
pnpm --filter @lens-and-sync/dish-lens... run build && pnpm --filter @lens-and-sync/shared-db run migrate:deploy
```

For `GOOGLE_CLOUD_CREDENTIALS_JSON` (and any other JSON secret), base64-encode the key file to avoid platform quoting issues:

```sh
# macOS/Linux
base64 -i service-account.json | tr -d '\n'

# PowerShell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("service-account.json"))
```

For `dish-lens` email features, add `MAILTRAP_API_TOKEN`, `EMAIL_FROM` (a verified sender address in your Mailtrap account), and `APP_BASE_URL` to the Railway environment.
