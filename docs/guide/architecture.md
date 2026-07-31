# Architecture

## Monorepo layout

```
lens-and-sync/
├── apps/
│   ├── dish-lens/      # Food-analysis API  (port 4002)
│   └── drive-sync/     # Drive → Pinecone sync worker  (port 4001)
├── packages/
│   ├── shared-auth/    # JWT sign/verify + requireAuth middleware
│   ├── shared-config/  # loadEnv + Zod schema helpers
│   ├── shared-db/      # Prisma client + schema
│   ├── shared-logger/  # Pino logger factory + security events
│   ├── shared-types/   # Cross-service TypeScript types
│   └── shared-utils/   # Express middleware (HTTPS, 404, error handler)
├── docs/               # This documentation site (VitePress)
└── infra/
    ├── docker-compose.yml
    └── terraform/
```

## Service interactions

```mermaid
graph TD
    Client["iOS / Web client"]

    subgraph DishLens
        DL_API["Express API\n:4002"]
        DL_Auth["Auth service\n(bcrypt + JWT)"]
        DL_Upload["Upload pipeline\n(Vision → Claude → Edamam)"]
        DL_History["Chat history\n(Postgres)"]
        DL_Meal["Meal planning\n(Postgres)"]
        DL_Email["Email\n(Resend)"]
    end

    subgraph DriveSync
        DS_API["Express API\n:4001"]
        DS_Worker["BullMQ worker\n(cron sync)"]
        DS_Embed["Embedding pipeline\n(OpenAI)"]
        DS_Retrieval["RAG retrieval"]
    end

    subgraph Infrastructure
        PG[("Postgres\n(shared schema)")]
        Redis[("Redis")]
        GCS["Google Cloud\nStorage"]
        Vision["Google\nVision API"]
        Claude["Anthropic\nClaude"]
        Edamam["Edamam\nNutrition API"]
        Drive["Google\nDrive API"]
        Pinecone[("Pinecone\nvector index")]
        OpenAI["OpenAI\nEmbeddings"]
        ResendSvc["Resend\n(email)"]
    end

    Client --> DL_API
    Client --> DS_API

    DL_API --> DL_Auth --> PG
    DL_API --> DL_Upload
    DL_Upload --> GCS
    DL_Upload --> Vision
    DL_Upload --> Claude
    DL_Upload --> Edamam
    DL_API --> DL_History --> PG
    DL_API --> DL_Meal --> PG
    DL_Auth --> DL_Email --> ResendSvc
    DL_API --> Redis

    DS_API --> DS_Retrieval --> Pinecone
    DS_Worker --> Drive
    DS_Worker --> DS_Embed --> OpenAI
    DS_Worker --> Pinecone
    DS_Worker --> PG
    DS_Worker --> Redis
```

## Authentication flow

Both services share the same JWT scheme. DishLens issues tokens; DriveSync only verifies them.

```
POST /auth/register  ──►  bcrypt hash  ──►  Postgres User row
                     ◄──  access + refresh tokens (JWT, signed with separate secrets)

POST /auth/login     ──►  bcrypt compare  ──►  issue token pair
POST /auth/refresh   ──►  sha256(token) lookup in RefreshToken table
                          revoke old row  ──►  issue new token pair
POST /auth/logout    ──►  revoke refresh token row
```

Email-based flows (verification, OTP, reset) store a `sha256(token)` in the `VerificationToken` table with an expiry and single-use flag.

## Database schema (shared)

```
User ──── RefreshToken (1:N)
     ──── SavedChat    (1:N)
     ──── MealPlan     (1:N) ──── MealEntry (1:N)
     ──── VerificationToken (1:N)

DriveFile  (DriveSync only)
```

## Sync worker lifecycle

```
Cron trigger (BullMQ)
  └─► Acquire Redis lock  (prevents overlap with manual triggers)
        └─► List Drive folders  ──►  detectChanges vs Postgres DriveFile rows
              ├─► New / updated files:
              │     extractText → computeContentHash → shouldReembed?
              │       └─► chunkText → generateEmbeddings → upsertChunkVectors
              │             └─► upsertSyncState (Postgres)
              └─► Deleted files:
                    deleteVectorsForFile (Pinecone) → deleteSyncState (Postgres)
  └─► Release lock  ──►  writeSyncStatus (Redis)
```
