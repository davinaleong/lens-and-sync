import { logSecurityEvent } from "@lens-and-sync/shared-logger";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { loginUser, registerUser, refreshTokens, revokeRefreshToken, type TokenConfig } from "../auth/service.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const authRouter: Router = Router();

const tokens: TokenConfig = {
  accessSecret: config.JWT_ACCESS_SECRET,
  refreshSecret: config.JWT_REFRESH_SECRET,
  accessTtl: config.JWT_ACCESS_TTL,
  refreshTtl: config.JWT_REFRESH_TTL,
};

// `.max(72)` matters, not just `.min(8)` - bcrypt silently truncates
// anything past 72 bytes rather than erroring, so without this cap two
// passwords differing only after byte 72 would hash identically, a
// confusing footgun a client would never see coming.
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid email and password (8-72 characters) are required." } });
      return;
    }

    const result = await registerUser(parsed.data.email, parsed.data.password, tokens);
    if (!result.ok) {
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/register", reason: result.reason, statusCode: 409 });
      res.status(409).json({ error: { code: "email-in-use", message: "An account with this email already exists." } });
      return;
    }

    res.status(201).json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid email and password are required." } });
      return;
    }

    const result = await loginUser(parsed.data.email, parsed.data.password, tokens);
    if (!result.ok) {
      // Same generic response and code regardless of whether the email
      // doesn't exist or the password was wrong - never lets a caller
      // enumerate registered emails (matches `requireAuth`'s own pattern
      // of a single, non-leaky failure shape).
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/login", reason: result.reason, statusCode: 401 });
      res.status(401).json({ error: { code: "invalid-credentials", message: "Invalid email or password." } });
      return;
    }

    res.status(200).json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A refresh token is required." } });
      return;
    }

    const result = await refreshTokens(parsed.data.refreshToken, tokens);
    if (!result.ok) {
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/refresh", reason: result.reason, statusCode: 401 });
      res.status(401).json({ error: { code: "invalid-refresh-token", message: "Refresh token is invalid, expired, or revoked." } });
      return;
    }

    res.status(200).json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A refresh token is required." } });
      return;
    }

    await revokeRefreshToken(parsed.data.refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const handleAuthError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "Unhandled error in /auth");
  res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
};

authRouter.use(handleAuthError);
