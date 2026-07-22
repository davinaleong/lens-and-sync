# Toolchain Decisions — 2026-07-22

The original specs (`01`–`03`) intentionally left several vendors generic
("embedding model", "LLM call", "nutrition API or LLM estimation", "object
storage"). This doc records the concrete choices made to flesh those out,
and why, so `.env.example` and `package.json` stop being placeholders.

## Decisions

| Concern | Choice | Why |
|---|---|---|
| Recipe generation LLM | **Anthropic Claude** (`claude-sonnet-5`, `@anthropic-ai/sdk`) | Strong structured-output quality for ingredients/steps. |
| DriveSync embeddings | **OpenAI** (`text-embedding-3-small`, `openai` SDK) | De facto standard for this use case; cheap; well-documented; dimension matches most Pinecone examples. |
| DishLens object storage | **Google Cloud Storage** (`@google-cloud/storage`) | Consolidates on Google — Drive and Vision already need a service account. GCS signed URLs satisfy the pre-signed-URL requirement in `01-security-checklist.md` §5 directly. |
| Image moderation (NSFW check) | **Reused Google Vision SafeSearch** — no separate provider | The same Vision call already made for dish detection (`src/vision/index.ts`) returns a SafeSearch annotation. Avoids a fourth vendor and a fourth API key for what's a single boolean-ish check. |
| DriveSync job scheduling/locking | **BullMQ + Redis** (`bullmq`, `ioredis`) | `02-milestones-checklist.md` #9 and `01-security-checklist.md` §4 both require locking to prevent overlapping sync runs. BullMQ gives that via Redis, which the stack already runs for DishLens sessions — no new infra. |
| DishLens rate limiting | **express-rate-limit + `rate-limit-redis`** | `01-security-checklist.md` §8 explicitly calls for a Redis-backed limiter "since you already have Redis." |
| Nutrition lookup | **Edamam** (already set in `.env.example` from the prior scaffolding pass — unchanged) | Simplest of the two options named in the spec; USDA remains a documented fallback if Edamam's free tier proves too limited. |

## What this changed

- `apps/drive-sync/package.json` — added `openai`, `bullmq`, `ioredis`.
- `apps/dish-lens/package.json` — added `@anthropic-ai/sdk`,
  `@google-cloud/storage`, `rate-limit-redis`.
- Both `.env.example` files — swapped generic placeholder keys
  (`EMBEDDING_PROVIDER_API_KEY`, `LLM_PROVIDER_API_KEY`,
  `OBJECT_STORAGE_*` AWS-shaped vars, `MODERATION_PROVIDER_API_KEY`) for
  concrete ones (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` +
  `ANTHROPIC_MODEL`, `GCS_BUCKET_NAME`, none — moderation is now a
  comment pointing at the Vision call).
- `apps/dish-lens/.env.example` — consolidated `GOOGLE_VISION_CREDENTIALS_JSON`
  into `GOOGLE_CLOUD_PROJECT_ID` + `GOOGLE_CLOUD_CREDENTIALS_JSON`, since one
  service account now backs both Vision and Cloud Storage.
- `infra/docker-compose.yml` — `drive-sync` now also `depends_on: redis`
  (needed for BullMQ).
- TODO comments in the relevant stub files (`embeddings/`, `jobs/`,
  `recipe/`, `vision/`, `moderation/`, `upload/`) now name the concrete
  tool instead of a generic placeholder, so the next implementation pass
  doesn't have to re-derive these decisions.

## Still generic / deferred

Per `01-security-checklist.md` §9–§12, these remain unresolved and don't
block *development* env vars (no local `.env` value is needed for them
yet):

- Secrets manager for staging/prod (Vault / AWS Secrets Manager / Doppler)
  — local dev keeps using `.env` files, untracked.
- Dependency scanning (Dependabot/Snyk) — not configured.
- APM/monitoring (Sentry/Datadog) — not configured.

No business logic was implemented in this pass — see
[`05-progress.md`](05-progress.md) for what's still stubbed.
