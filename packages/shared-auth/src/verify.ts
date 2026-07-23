import jwt from "jsonwebtoken";

export type VerifyAccessTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "invalid" };

/**
 * Verifies a JWT access token's signature and expiry, and extracts the
 * user ID from its `sub` claim. This is the only place a request's
 * `userId` should ever come from - never a client-supplied body/query/
 * header field (`01-security-checklist.md` §1's "never trust
 * client-supplied user/role IDs — derive identity from the verified token
 * only").
 */
export function verifyAccessToken(token: string | undefined, secret: string): VerifyAccessTokenResult {
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }

  if (typeof payload === "string" || typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, userId: payload.sub };
}
