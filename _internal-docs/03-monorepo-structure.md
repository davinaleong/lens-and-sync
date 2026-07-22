# Monorepo Structure — DriveSync & DishLens

Reflects finalized decisions: Pinecone (vector store), Redis (session state), Postgres + Prisma (persistent storage, centralized in `shared-db`), Laplacian blur detection, pnpm + Turborepo.

```
recipe-platform/
├── apps/
│   ├── drive-sync/                       # DriveSync API
│   │   ├── src/
│   │   │   ├── auth/                     # Google service account / OAuth
│   │   │   ├── drive/                    # Drive API client, change detection
│   │   │   ├── extraction/               # Docs/PDF/Sheets → text
│   │   │   ├── chunking/
│   │   │   ├── embeddings/
│   │   │   ├── vector-store/
│   │   │   │   └── pinecone-client.ts    # upsert, delete, query, namespace mgmt
│   │   │   ├── retrieval/                # query endpoint
│   │   │   ├── jobs/                     # scheduled sync jobs, locking
│   │   │   ├── routes/
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── dish-lens/                        # DishLens API
│       ├── src/
│       │   ├── upload/                   # image intake, validation
│       │   ├── preprocessing/
│       │   │   ├── image-normalize.ts    # sharp re-encode, EXIF strip, HEIC handling
│       │   │   └── blur-detection.ts     # Laplacian variance check
│       │   ├── vision/                   # Google Vision integration
│       │   ├── edge-cases/               # multi-dish, low-confidence, non-dish rejection logic
│       │   ├── recipe/                   # LLM recipe generation
│       │   ├── nutrition/                # nutrition lookup/estimation
│       │   ├── session/
│       │   │   ├── redis-client.ts
│       │   │   └── session-store.ts      # get/set/expire session state
│       │   ├── history/
│       │   │   ├── save-chat.ts          # snapshot Redis session → Postgres
│       │   │   └── list-chats.ts         # fetch saved chats for a user
│       │   ├── moderation/               # abuse/rate limiting, content moderation
│       │   ├── routes/
│       │   └── index.ts
│       ├── tests/
│       │   └── fixtures/                 # sample images per edge case, blur calibration set
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── shared-db/                        # Prisma — single source of truth for both apps
│   │   ├── prisma/
│   │   │   ├── schema.prisma             # DriveFile + SavedChat models
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   └── client.ts                 # exported PrismaClient singleton
│   │   └── package.json
│   ├── shared-types/                     # shared TS types/interfaces across apps
│   ├── shared-config/                    # env schema, config loader
│   ├── shared-logger/                    # common logging setup
│   ├── shared-auth/                      # shared auth middleware (if apps share a gateway)
│   └── shared-utils/                     # generic helpers (retry, validation, etc.)
│
├── infra/
│   ├── docker-compose.yml                # local dev: both APIs + Postgres + Redis
│   ├── terraform/ (or pulumi/)           # cloud infra as code
│   └── ci/                               # shared CI pipeline configs
│
├── .github/
│   └── workflows/                        # CI/CD, one pipeline per app + shared checks
│
├── package.json                          # workspace root
├── pnpm-workspace.yaml                   # or yarn/nx equivalent depending on final tooling choice
├── turbo.json                            # if Turborepo confirmed
├── tsconfig.base.json
└── README.md
```

**Resolved (2026-07-22):** workspace tooling is pnpm + Turborepo. Scaffolded in full — see `05-progress.md`.
