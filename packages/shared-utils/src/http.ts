import type { Logger } from "@lens-and-sync/shared-logger";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Rejects any request that reached the app over plain HTTP once running
 * in production - real TLS termination should happen at the load
 * balancer, but this is a defense-in-depth backstop for
 * `01-security-checklist.md` §2's "enforce HTTPS everywhere." A no-op
 * outside production, so local dev over plain `http://` still works.
 *
 * If the app runs behind a TLS-terminating proxy/load balancer, the
 * caller must set `app.set("trust proxy", ...)` so Express derives
 * `req.secure` from the proxy's `X-Forwarded-Proto` header rather than
 * the (plain HTTP) hop between the proxy and this app - otherwise every
 * production request would be rejected regardless of the client's real
 * connection.
 */
export function enforceHttps(nodeEnv: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (nodeEnv !== "production" || req.secure) {
      next();
      return;
    }
    res.status(403).json({ error: { code: "https-required", message: "HTTPS is required." } });
  };
}

/** A consistent JSON 404 instead of Express's default HTML "Cannot GET /x" page. */
export function notFoundHandler(): RequestHandler {
  return (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "not-found", message: "Not found." } });
  };
}

/**
 * Last-resort error handler for anything not caught by a route's own
 * error-handling middleware - most notably body-parser errors (e.g.
 * malformed JSON), which occur in global middleware *before* Express ever
 * reaches route-level handlers and would otherwise fall through to
 * Express's own default error handler (an HTML page that can include a
 * stack trace - `01-security-checklist.md` §11). Must be registered last,
 * after every router.
 */
function clientErrorStatus(err: unknown): number | undefined {
  // body-parser (via `express.json()`) throws a `SyntaxError` with a
  // `status`/`statusCode` of 400 for a malformed body - a genuine client
  // error, not a server fault, so it shouldn't be reported as a 500. Only
  // trust this for the 400-499 range; anything else falls through to the
  // generic 500 below rather than letting an upstream library's error
  // object dictate an unexpected status code.
  const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status ?? (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : undefined;
}

export function createFallbackErrorHandler(logger: Logger) {
  return (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    logger.error({ err }, "Unhandled error reached the app-level fallback handler");
    const status = clientErrorStatus(err);
    if (status) {
      res.status(status).json({ error: { code: "invalid-request", message: "The request could not be processed." } });
      return;
    }
    res.status(500).json({ error: { code: "internal-error", message: "An unexpected error occurred." } });
  };
}
