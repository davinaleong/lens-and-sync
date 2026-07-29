import { z } from "zod";
import { commaSeparated, loadEnv, logLevelSchema, nodeEnvSchema } from "@lens-and-sync/shared-config";

const schema = z.object({
  PORT: z.coerce.number().default(4001),
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  CORS_ALLOWED_ORIGINS: commaSeparated,

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_TTL: z.string().min(1),
  JWT_REFRESH_TTL: z.string().min(1),

  RATE_LIMIT_WINDOW_MS: z.coerce.number(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number(),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().min(1),
  GOOGLE_DRIVE_FOLDER_IDS: commaSeparated,

  PINECONE_API_KEY: z.string().min(1),
  PINECONE_INDEX_NAME: z.string().min(1),
  PINECONE_NAMESPACE: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SYNC_QUEUE_NAME: z.string().min(1),
  SYNC_CRON_SCHEDULE: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

export const config: Config = loadEnv(schema);
