import { logSecurityEvent } from "@lens-and-sync/shared-logger";
import type { ErrorRequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { loginUser, registerUser, refreshTokens, revokeRefreshToken, type TokenConfig } from "../auth/service.js";
import { requestEmailVerification, requestOtp, requestPasswordReset, resetPassword, verifyEmailToken, verifyOtp } from "../auth/verification.js";
import { config } from "../config.js";
import { requireAuth, type AuthenticatedRequest } from "@lens-and-sync/shared-auth";
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

    // Fire-and-forget: failure to send the verification email must not
    // block the registration response or leave the user without tokens.
    requestEmailVerification(result.userId, config.APP_BASE_URL).catch((err) =>
      logger.error({ err }, "Failed to send verification email after register"),
    );

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

// --- Email verification ---

const tokenSchema = z.object({ token: z.string().min(1) });

authRouter.post("/verify-email", async (req, res, next) => {
  try {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A verification token is required." } });
      return;
    }
    const result = await verifyEmailToken(parsed.data.token);
    if (!result.ok) {
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/verify-email", reason: result.reason, statusCode: 400 });
      res.status(400).json({ error: { code: result.reason, message: "Email verification failed." } });
      return;
    }
    res.status(200).json({ message: "Email verified." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/resend-verification", requireAuth(config.JWT_ACCESS_SECRET, logger), async (req: AuthenticatedRequest, res, next) => {
  try {
    await requestEmailVerification(req.userId as string, config.APP_BASE_URL);
    res.status(200).json({ message: "Verification email sent if the address is unverified." });
  } catch (err) {
    next(err);
  }
});

// --- Email OTP ---

const emailSchema = z.object({ email: z.string().email() });
const otpSchema = z.object({ email: z.string().email(), code: z.string().length(6) });

authRouter.post("/send-otp", async (req, res, next) => {
  try {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid email is required." } });
      return;
    }
    await requestOtp(parsed.data.email);
    res.status(200).json({ message: "If an account exists for this email, a login code has been sent." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/verify-otp", async (req, res, next) => {
  try {
    const parsed = otpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid email and 6-digit code are required." } });
      return;
    }
    const result = await verifyOtp(parsed.data.email, parsed.data.code, tokens);
    if (!result.ok) {
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/verify-otp", reason: result.reason, statusCode: 401 });
      res.status(401).json({ error: { code: "invalid-otp", message: "OTP is invalid or expired." } });
      return;
    }
    res.status(200).json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  } catch (err) {
    next(err);
  }
});

// --- Password reset ---

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A valid email is required." } });
      return;
    }
    await requestPasswordReset(parsed.data.email, config.APP_BASE_URL);
    res.status(200).json({ message: "If an account exists for this email, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid-request", message: "A reset token and new password (8–72 characters) are required." } });
      return;
    }
    const result = await resetPassword(parsed.data.token, parsed.data.password);
    if (!result.ok) {
      logSecurityEvent(logger, { type: "auth-failed", route: "POST /auth/reset-password", reason: result.reason, statusCode: 400 });
      res.status(400).json({ error: { code: result.reason, message: "Password reset failed." } });
      return;
    }
    res.status(200).json({ message: "Password reset successfully." });
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
