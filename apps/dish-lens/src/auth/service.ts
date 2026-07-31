import { createHash } from "node:crypto";
import { signToken, verifyAccessToken } from "@lens-and-sync/shared-auth";
import { prisma } from "@lens-and-sync/shared-db";
import { hashPassword, verifyPassword } from "./hash.js";

export interface TokenConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type RegisterResult = { ok: true; userId: string } & TokenPair | { ok: false; reason: "email-in-use" };
export type LoginResult = { ok: true } & TokenPair | { ok: false; reason: "invalid-credentials" };
export type RefreshResult = { ok: true } & TokenPair | { ok: false; reason: "invalid-refresh-token" };

// A fixed, precomputed bcrypt hash (of an arbitrary string nobody will ever
// register with) - `loginUser` compares against this when no user matches
// the given email, so a login attempt for a nonexistent account takes
// roughly the same time as one for a real account with a wrong password.
// Without this, response timing alone would leak which emails are
// registered (the same enumeration concern `getSavedChat`'s not-found vs
// not-yours indistinguishability addresses elsewhere in this app).
const DUMMY_PASSWORD_HASH = "$2a$12$4DAzNC/YwQJOWZrzwXEbuOAchYmdvP2sAKlKnYys/Q.mwoF71PagK";

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Refresh tokens are high-entropy signed JWTs, not low-entropy human
// passwords - SHA-256 (deterministic) is correct here, not bcrypt/bcryptjs
// (salted per-call, so unusable for the exact-match `tokenHash` lookup
// `refreshTokens` below needs to check revocation).
// Exported so verification.ts can reuse it for OTP and future flows.
export async function issueTokenPair(userId: string, tokens: TokenConfig): Promise<TokenPair> {
  const accessToken = signToken(userId, tokens.accessSecret, tokens.accessTtl);
  const refreshToken = signToken(userId, tokens.refreshSecret, tokens.refreshTtl);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashRefreshToken(refreshToken) },
  });
  return { accessToken, refreshToken };
}

export async function registerUser(email: string, password: string, tokens: TokenConfig): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, reason: "email-in-use" };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  const pair = await issueTokenPair(user.id, tokens);
  return { ok: true, userId: user.id, ...pair };
}

export async function loginUser(email: string, password: string, tokens: TokenConfig): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "invalid-credentials" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false, reason: "invalid-credentials" };
  }

  const pair = await issueTokenPair(user.id, tokens);
  return { ok: true, ...pair };
}

/**
 * Verifies + rotates a refresh token: the old row is revoked and a new
 * access/refresh pair issued, so a stolen-then-reused old refresh token
 * fails on its second use (`stored.revokedAt` will already be set).
 */
export async function refreshTokens(refreshToken: string, tokens: TokenConfig): Promise<RefreshResult> {
  const verified = verifyAccessToken(refreshToken, tokens.refreshSecret);
  if (!verified.ok) {
    return { ok: false, reason: "invalid-refresh-token" };
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.userId !== verified.userId) {
    return { ok: false, reason: "invalid-refresh-token" };
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const pair = await issueTokenPair(verified.userId, tokens);
  return { ok: true, ...pair };
}

// Idempotent and never reveals whether `refreshToken` was ever valid -
// logout always "succeeds" from the caller's point of view.
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
