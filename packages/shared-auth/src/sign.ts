import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * Signs a token carrying `userId` in the `sub` claim - the same claim
 * `verifyAccessToken` reads back out. One function for both access and
 * refresh tokens (same shape, different secret/ttl callers pass in) rather
 * than two near-identical `sign*Token` functions.
 *
 * `jwtid` (a random UUID) is required, not cosmetic: JWTs are otherwise
 * deterministic given the same payload/secret/second-granularity `iat`, so
 * two tokens signed for the same user within the same second would
 * otherwise be byte-identical - which breaks any caller storing a hash of
 * the token in a column with a uniqueness constraint (e.g. a refresh-token
 * table keyed on `sha256(token)`).
 */
export function signToken(userId: string, secret: string, ttl: string): string {
  // `ttl` is a plain string here (config.ts only validates `.min(1)`, since
  // it's a generic env var, not literally typed as `jwt.SignOptions`'s
  // `StringValue` union) - the cast is safe because `jwt.sign` itself parses
  // this value with the same `ms`-compatible logic at runtime regardless of
  // its compile-time type.
  return jwt.sign({ sub: userId }, secret, {
    expiresIn: ttl as jwt.SignOptions["expiresIn"],
    jwtid: randomUUID(),
  });
}
