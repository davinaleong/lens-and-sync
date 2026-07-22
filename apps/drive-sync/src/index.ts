import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "./config.js";
import { redis } from "./redis-client.js";
import { syncRouter } from "./routes/sync.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.CORS_ALLOWED_ORIGINS }));
app.use(express.json());
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

app.listen(config.PORT, () => {
  console.log(`drive-sync listening on :${config.PORT}`);
});
