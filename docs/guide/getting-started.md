# Getting started

## Prerequisites

| Tool    | Version                                         |
| ------- | ----------------------------------------------- |
| Node.js | ≥ 20                                            |
| pnpm    | 9.x (`corepack enable && corepack prepare`)     |
| Docker  | any recent version (for local Postgres + Redis) |

## 1. Clone and install

```sh
git clone https://github.com/davinaleong/lens-and-sync.git
cd lens-and-sync
pnpm install
```

## 2. Start backing services

```sh
docker compose -f infra/docker-compose.yml up -d postgres redis
```

This starts Postgres on `localhost:5432` and Redis on `localhost:6379` using the credentials in the compose file.

## 3. Configure environment variables

Copy the example files for each app you want to run:

```sh
cp apps/dish-lens/.env.example  apps/dish-lens/.env
cp apps/drive-sync/.env.example apps/drive-sync/.env
```

Then fill in the required values — see [Environment variables](/reference/environment-variables) for the full reference.

## 4. Run migrations

```sh
pnpm db:migrate
```

This runs `prisma migrate dev` against the shared database and generates the Prisma client.

## 5. Start the services

```sh
# Both services in watch mode (via Turborepo)
pnpm dev

# Or individually
pnpm --filter @lens-and-sync/dish-lens  dev
pnpm --filter @lens-and-sync/drive-sync dev
```

| Service   | URL                   |
| --------- | --------------------- |
| DishLens  | http://localhost:4002 |
| DriveSync | http://localhost:4001 |

## Useful commands

```sh
pnpm build        # Compile all packages and apps
pnpm test         # Run all test suites
pnpm typecheck    # Type-check without emitting
pnpm lint         # ESLint across the whole repo
pnpm db:migrate   # Create + apply a Prisma migration (dev)
pnpm db:generate  # Regenerate the Prisma client only
```

## Quick smoke test

Once DishLens is running, register an account and upload a photo:

```sh
BASE=http://localhost:4002

# Register
curl -s -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq

# Upload a dish photo (returns recipe + nutrition)
TOKEN="<accessToken from register>"
curl -s -X POST $BASE/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/dish.jpg" | jq
```
