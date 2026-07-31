import { createFallbackErrorHandler, enforceHttps, notFoundHandler } from "@lens-and-sync/shared-utils";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { historyRouter } from "./routes/history.js";
import { uploadRouter } from "./routes/upload.js";
import { redis } from "./session/redis-client.js";

const app = express();

// Required for `enforceHttps`/`req.secure` to reflect the client's real
// connection when this app sits behind a TLS-terminating proxy/load
// balancer, rather than the (plain HTTP) proxy-to-app hop.
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(
  helmet({
    // This is a JSON API, not an HTML app - no scripts/styles/frames are
    // ever legitimately served, so the strictest possible CSP is also the
    // correct one (defense-in-depth in case a response is ever rendered
    // as HTML by mistake, e.g. an error page proxied through unexpectedly).
    // `useDefaults: false` - otherwise helmet merges in its default
    // font-src/img-src/style-src/etc. directives alongside `defaultSrc`,
    // which are meaningless permissions for an API that never serves HTML
    // and only dilute the "nothing is allowed" intent.
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

app.use("/auth", authRouter);
app.use("/upload", uploadRouter);
app.use("/chats", historyRouter);

app.use(notFoundHandler());
app.use(createFallbackErrorHandler(logger));

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "dish-lens listening");
});
