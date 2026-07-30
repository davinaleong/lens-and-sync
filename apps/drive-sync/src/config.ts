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

  GOOGLE_CLOUD_CREDENTIALS_JSON: z.string().min(1).transform((s) => JSON.parse(s) as Record<string, unknown>),
  GOOGLE_DRIVE_FOLDER_IDS: commaSeparated,

  PINECONE_API_KEY: z.string().min(1),
  PINECONE_INDEX_NAME: z.string().min(1),
  PINECONE_NAMESPACE: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),
  // Must match the target Pinecone index's own configured dimension -
  // `text-embedding-3-small` defaults to 1536 but supports shortening via
  // the `dimensions` request parameter. Optional: omitted means "use the
  // model's default," which only works if the Pinecone index was created
  // with that same default dimension.
  EMBEDDING_DIMENSIONS: z.coerce.number().optional(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SYNC_QUEUE_NAME: z.string().min(1),
  SYNC_CRON_SCHEDULE: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

export const config: Config = loadEnv(schema);
