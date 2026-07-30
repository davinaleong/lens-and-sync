import { createFallbackErrorHandler, enforceHttps, notFoundHandler } from "@lens-and-sync/shared-utils";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { Redis } from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "./config.js";
import { driveClient } from "./drive/client.js";
import { openaiClient } from "./embeddings/client.js";
import { createSyncQueue, createSyncWorker, runSyncOnce, scheduleSyncJob } from "./jobs/index.js";
import { logger } from "./logger.js";
import { redis } from "./redis-client.js";
import { syncRouter } from "./routes/sync.js";
import { vectorIndex } from "./vector-store/pinecone-client.js";

const app = express();

// Required for `enforceHttps`/`req.secure` to reflect the client's real
// connection when this app sits behind a TLS-terminating proxy/load
// balancer, rather than the (plain HTTP) proxy-to-app hop.
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(
  helmet({
    // JSON API, not an HTML app - no scripts/styles/frames are ever
    // legitimately served, so the strictest CSP is also the correct one.
    // `useDefaults: false` - see dish-lens's `index.ts` for why.
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"] } },
  }),
);
app.use(enforceHttps(config.NODE_ENV));
app.use(cors({ origin: config.CORS_ALLOWED_ORIGINS }));
app.use(express.json({ limit: "100kb" }));
app.use(
  rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(args[0] as string, ...args.slice(1)) as Promise<RedisReply>,
    }),
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/sync", syncRouter);

app.use(notFoundHandler());
app.use(createFallbackErrorHandler(logger));

// BullMQ needs its own dedicated Redis connection for the Worker's
// blocking consumption loop - sharing the app's `redis` (already used for
// rate-limiting) would let the two contend over the same connection's
// blocking commands. `maxRetriesPerRequest: null` is required by BullMQ
// for the same reason `redis-client.ts`'s shared instance already sets it.
const bullConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const syncQueue = createSyncQueue(bullConnection, config.SYNC_QUEUE_NAME);
await scheduleSyncJob(syncQueue, config.SYNC_CRON_SCHEDULE);

// The lock itself (`jobs/lock.ts`) only ever issues non-blocking SET/EVAL
// commands, so it's safe to share the app's existing `redis` connection
// rather than needing a third dedicated one.
createSyncWorker(
  bullConnection,
  config.SYNC_QUEUE_NAME,
  redis,
  () =>
    runSyncOnce({
      drive: driveClient,
      folderIds: config.GOOGLE_DRIVE_FOLDER_IDS,
      embeddingClient: openaiClient,
      embeddingModel: config.EMBEDDING_MODEL,
      embeddingDimensions: config.EMBEDDING_DIMENSIONS,
      vectorIndex,
      logger,
    }),
  logger,
);

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, cron: config.SYNC_CRON_SCHEDULE }, "drive-sync listening");
});
