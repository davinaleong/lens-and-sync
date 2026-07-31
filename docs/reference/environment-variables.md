# Environment variables

## DishLens

Copy `apps/dish-lens/.env.example` → `apps/dish-lens/.env` and fill in all values.

### Server

| Variable               | Default                 | Description                                                  |
| ---------------------- | ----------------------- | ------------------------------------------------------------ |
| `PORT`                 | `4002`                  | HTTP port                                                    |
| `NODE_ENV`             | `development`           | `development` \| `test` \| `production`                      |
| `LOG_LEVEL`            | `info`                  | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed CORS origins                 |

### Auth

| Variable             | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `JWT_ACCESS_SECRET`  | Signing secret for access tokens. Use `openssl rand -hex 32`.      |
| `JWT_REFRESH_SECRET` | Signing secret for refresh tokens. Must differ from access secret. |
| `JWT_ACCESS_TTL`     | Access token TTL (e.g. `15m`)                                      |
| `JWT_REFRESH_TTL`    | Refresh token TTL (e.g. `30d`)                                     |

### Google Cloud

| Variable                        | Description                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLOUD_PROJECT_ID`       | Your GCP project ID                                                                                                                                  |
| `GOOGLE_CLOUD_CREDENTIALS_JSON` | Service account key file contents — plain JSON, quote-wrapped JSON, or base64-encoded. [See deployment guide.](/guide/deployment#google-credentials) |

### Recipe generation

| Variable            | Default           | Description       |
| ------------------- | ----------------- | ----------------- |
| `ANTHROPIC_API_KEY` | —                 | Anthropic API key |
| `ANTHROPIC_MODEL`   | `claude-sonnet-5` | Model ID          |

### Nutrition

| Variable                 | Description      |
| ------------------------ | ---------------- |
| `NUTRITION_API_PROVIDER` | Must be `edamam` |
| `NUTRITION_API_APP_ID`   | Edamam App ID    |
| `NUTRITION_API_APP_KEY`  | Edamam App Key   |

### Storage

| Variable                        | Default | Description                 |
| ------------------------------- | ------- | --------------------------- |
| `GCS_BUCKET_NAME`               | —       | Google Cloud Storage bucket |
| `GCS_SIGNED_URL_EXPIRY_SECONDS` | `3600`  | Signed URL validity         |

### Redis

| Variable                    | Default                  | Description            |
| --------------------------- | ------------------------ | ---------------------- |
| `REDIS_URL`                 | `redis://localhost:6379` | Redis connection URL   |
| `REDIS_SESSION_TTL_SECONDS` | —                        | Session TTL in seconds |

### Database

| Variable       | Default                                                           | Description                |
| -------------- | ----------------------------------------------------------------- | -------------------------- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/lens_and_sync_dev` | Postgres connection string |

### Upload limits

| Variable                 | Default | Description                   |
| ------------------------ | ------- | ----------------------------- |
| `MAX_UPLOAD_SIZE_MB`     | `20`    | Max upload size in megabytes  |
| `MAX_IMAGE_DIMENSION_PX` | `8192`  | Max image dimension in pixels |

### Detection thresholds

| Variable                    | Default | Description                                              |
| --------------------------- | ------- | -------------------------------------------------------- |
| `BLUR_VARIANCE_THRESHOLD`   | `100`   | Laplacian variance below this → image is too blurry      |
| `DISH_CONFIDENCE_THRESHOLD` | `0.6`   | Minimum Vision confidence for a label to count as a dish |
| `FOOD_EVIDENCE_THRESHOLD`   | `0.5`   | Minimum confidence for generic food evidence labels      |

### Rate limiting

| Variable                        | Default  | Description                   |
| ------------------------------- | -------- | ----------------------------- |
| `RATE_LIMIT_WINDOW_MS`          | `60000`  | Global rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS`       | `30`     | Max requests per window       |
| `UPLOAD_RATE_LIMIT_WINDOW_MS`   | `600000` | Upload rate limit window (ms) |
| `UPLOAD_RATE_LIMIT_MAX_UPLOADS` | `20`     | Max uploads per window        |

### Email

| Variable         | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Resend API key from [resend.com](https://resend.com)                            |
| `EMAIL_FROM`     | Verified sender address, e.g. `DishLens <noreply@yourdomain.com>`               |
| `APP_BASE_URL`   | Base URL for email links. Production: Railway URL. Dev: `http://localhost:4002` |

---

## DriveSync

Copy `apps/drive-sync/.env.example` → `apps/drive-sync/.env` and fill in all values.

### Server

| Variable               | Default                 | Description                             |
| ---------------------- | ----------------------- | --------------------------------------- |
| `PORT`                 | `4001`                  | HTTP port                               |
| `NODE_ENV`             | `development`           | `development` \| `test` \| `production` |
| `LOG_LEVEL`            | `info`                  | Pino log level                          |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Allowed CORS origins                    |

### Auth (shared with DishLens)

| Variable             | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`  | Must match DishLens — DriveSync only verifies tokens, never issues them |
| `JWT_REFRESH_SECRET` | Must match DishLens                                                      |
| `JWT_ACCESS_TTL`     | Must match DishLens                                                      |
| `JWT_REFRESH_TTL`    | Must match DishLens                                                      |

### Rate limiting

| Variable                  | Default | Description             |
| ------------------------- | ------- | ----------------------- |
| `RATE_LIMIT_WINDOW_MS`    | `60000` | Window in ms            |
| `RATE_LIMIT_MAX_REQUESTS` | `30`    | Max requests per window |

### Google Drive

| Variable                        | Description                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `GOOGLE_CLOUD_CREDENTIALS_JSON` | Service account key — plain JSON, quote-wrapped, or base64. Same format as DishLens. |
| `GOOGLE_DRIVE_FOLDER_IDS`       | Comma-separated list of Drive folder IDs to index                                     |

### Pinecone

| Variable              | Description                |
| --------------------- | -------------------------- |
| `PINECONE_API_KEY`    | Pinecone API key           |
| `PINECONE_INDEX_NAME` | Name of the Pinecone index |
| `PINECONE_NAMESPACE`  | Namespace within the index |

### Embeddings

| Variable               | Default                  | Description                                                               |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `OPENAI_API_KEY`       | —                        | OpenAI API key                                                            |
| `EMBEDDING_MODEL`      | `text-embedding-3-small` | Embedding model ID                                                        |
| `EMBEDDING_DIMENSIONS` | _(model default)_        | Optional dimension override. Must match the Pinecone index configuration. |

### Database

| Variable       | Default                                                           | Description     |
| -------------- | ----------------------------------------------------------------- | --------------- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/lens_and_sync_dev` | Shared Postgres |

### Redis / BullMQ

| Variable          | Default                  | Description          |
| ----------------- | ------------------------ | -------------------- |
| `REDIS_URL`       | `redis://localhost:6379` | Redis connection URL |
| `SYNC_QUEUE_NAME` | —                        | BullMQ queue name    |

### Sync schedule

| Variable             | Example        | Description                      |
| -------------------- | -------------- | -------------------------------- |
| `SYNC_CRON_SCHEDULE` | `*/15 * * * *` | Cron expression for the sync job |
