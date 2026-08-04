import { z } from "zod";
import { commaSeparated, jsonObject, loadEnv, logLevelSchema, nodeEnvSchema } from "@lens-and-sync/shared-config";

const schema = z.object({
  PORT: z.coerce.number().default(4002),
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  CORS_ALLOWED_ORIGINS: commaSeparated,

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_TTL: z.string().min(1),
  JWT_REFRESH_TTL: z.string().min(1),

  GOOGLE_CLOUD_PROJECT_ID: z.string().min(1),
  GOOGLE_CLOUD_CREDENTIALS_JSON: jsonObject,

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),

  NUTRITION_API_PROVIDER: z.string().min(1),
  NUTRITION_API_APP_ID: z.string().min(1),
  NUTRITION_API_APP_KEY: z.string().min(1),

  GCS_BUCKET_NAME: z.string().min(1),
  GCS_SIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(3600),

  REDIS_URL: z.string().url(),
  REDIS_SESSION_TTL_SECONDS: z.coerce.number(),

  DATABASE_URL: z.string().url(),

  MAX_UPLOAD_SIZE_MB: z.coerce.number(),
  MAX_IMAGE_DIMENSION_PX: z.coerce.number(),
  BLUR_VARIANCE_THRESHOLD: z.coerce.number(),

  DISH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.6),
  FOOD_EVIDENCE_THRESHOLD: z.coerce.number().default(0.5),

  RATE_LIMIT_WINDOW_MS: z.coerce.number(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number(),

  UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number(),
  UPLOAD_RATE_LIMIT_MAX_UPLOADS: z.coerce.number(),

  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  APP_BASE_URL: z.string().url(),

  // Optional - when unset, chat replies skip personal-recipe lookup
  // entirely rather than failing. Lets drive-sync's RAG query/document
  // endpoints be queried during chat replies, using the same request's
  // own bearer token (both services share JWT_ACCESS_SECRET).
  DRIVE_SYNC_BASE_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof schema>;

export const config: Config = loadEnv(schema);
