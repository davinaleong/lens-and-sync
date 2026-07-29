import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./verify.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

// A minimal structural interface (not an import from `shared-logger`, to
// avoid a hard dependency from `shared-auth` on the logging package) -
// `shared-logger`'s pino `Logger` already satisfies this shape, so callers
// can pass their app's real logger straight through.
export interface AuthEventLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : undefined;
}

/**
 * Express middleware requiring a valid access token. On success, attaches
 * the verified `userId` to `req.userId` - route handlers must read
 * identity from there, never from a client-supplied field. On failure,
 * always returns the same clean `401` with a fixed, non-leaky message,
 * regardless of *why* verification failed (missing/malformed/expired/
 * invalid all look identical to the client) - iOS clients rely on a clean
 * 401 to trigger token refresh across app backgrounding, not a hang or a
 * differently-shaped error per failure mode
 * (`01-security-checklist.md` §1).
 */
export function requireAuth(secret: string, logger?: AuthEventLogger) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);
    const result = verifyAccessToken(token, secret);

    if (!result.ok) {
      // Internal reason (missing/malformed/expired/invalid) is logged
      // server-side only - the client response stays identical regardless
      // of why verification failed, per this middleware's own contract.
      // `req.originalUrl`, not `req.path` - inside a sub-router mounted at
      // e.g. `/upload`, `req.path` is relative to the mount point and would
      // log every rejection as the unhelpful "POST /".
      logger?.warn(
        { event: "auth-rejected", route: `${req.method} ${req.originalUrl}`, reason: result.reason, statusCode: 401 },
        "authentication rejected",
      );
      res.status(401).json({ error: { code: "unauthorized", message: "Authentication required." } });
      return;
    }

    req.userId = result.userId;
    next();
  };
}
