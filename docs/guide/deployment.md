# Deployment

Both services are deployed on [Railway](https://railway.app). Each service is a separate Railway service connected to a shared Postgres and Redis instance.

## Prerequisites

- Railway project with Postgres and Redis services provisioned
- Google Cloud project with Vision API and Cloud Storage enabled
- Anthropic API key
- Edamam API credentials
- Resend account + verified sender domain
- Pinecone index (DriveSync only)
- OpenAI API key (DriveSync only)

## DishLens

### Railway build command

```
pnpm --filter @lens-and-sync/dish-lens... run build && pnpm --filter @lens-and-sync/shared-db run migrate:deploy
```

The `migrate:deploy` step runs all pending Prisma migrations against the production database **before** the new app code starts. This ordering is critical — never deploy the app without running migrations first.

### Start command

```
node apps/dish-lens/dist/index.js
```

### Required environment variables

See [DishLens environment variables](/reference/environment-variables#dishlens).

## DriveSync

### Railway build command

```
pnpm --filter @lens-and-sync/drive-sync... run build
```

DriveSync shares the same database as DishLens. Migrations are only run from the DishLens build step — running them twice is idempotent but the DishLens deploy must happen first.

### Start command

```
node apps/drive-sync/dist/index.js
```

### Required environment variables

See [DriveSync environment variables](/reference/environment-variables#drivesync).

## Google credentials

The `GOOGLE_CLOUD_CREDENTIALS_JSON` environment variable must be set to the contents of your Google service account key file. To avoid quoting and newline issues on Railway, **base64-encode it**:

```sh
# macOS / Linux
base64 -i service-account.json | tr -d '\n'

# PowerShell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("service-account.json"))
```

Paste the single-line result as the env var value. The config parser handles plain JSON, quote-wrapped JSON, and base64 automatically.

## Database migrations

Prisma migrations live in `packages/shared-db/prisma/migrations/`. They are applied with:

```sh
# Development (creates a new migration from schema changes)
pnpm db:migrate

# Production (applies pending migrations only, no interactive prompt)
pnpm --filter @lens-and-sync/shared-db run migrate:deploy
```

## Post-deployment smoke test

```sh
BASE=https://dish-lens-production.up.railway.app

# Register
curl -s -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq

# Login
TOKENS=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}')
ACCESS=$(echo $TOKENS | jq -r .accessToken)
REFRESH=$(echo $TOKENS | jq -r .refreshToken)

# Refresh (old token rejected afterwards)
NEW=$(curl -s -X POST $BASE/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH\"}")

# Protected route
curl -s $BASE/chats \
  -H "Authorization: Bearer $(echo $NEW | jq -r .accessToken)" | jq

# Logout
curl -s -X POST $BASE/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$(echo $NEW | jq -r .refreshToken)\"}"
```
