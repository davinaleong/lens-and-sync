import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "@lens-and-sync/shared-db";
import { sendOtpEmail, sendPasswordResetEmail, sendVerificationEmail } from "./email.js";
import { hashPassword } from "./hash.js";
import { issueTokenPair, type TokenConfig } from "./service.js";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;  // 24 h
const RESET_TTL_MS  =      60 * 60 * 1000;  // 1 h
const OTP_TTL_MS    =  10 * 60 * 1000;      // 10 min

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// --- Email verification ---

export async function requestEmailVerification(userId: string, baseUrl: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!user || user.emailVerified) return;

  const rawToken = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { userId, tokenHash: sha256(rawToken), type: "EMAIL_VERIFICATION", expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  await sendVerificationEmail(user.email, `${baseUrl}/auth/verify-email?token=${rawToken}`);
}

export type VerifyEmailResult =
  | { ok: true }
  | { ok: false; reason: "invalid-token" | "expired-token" | "already-verified" };

export async function verifyEmailToken(rawToken: string): Promise<VerifyEmailResult> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: { select: { emailVerified: true } } },
  });

  if (!record || record.type !== "EMAIL_VERIFICATION" || record.usedAt) {
    return { ok: false, reason: "invalid-token" };
  }
  if (record.user.emailVerified) return { ok: false, reason: "already-verified" };
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired-token" };

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
  ]);
  return { ok: true };
}

// --- Email OTP ---

export async function requestOtp(email: string): Promise<void> {
  // Always resolves — never reveal whether the email is registered.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;

  // Include userId in the hash so two users with the same 6-digit code
  // don't collide on the unique tokenHash constraint.
  const code = String(randomInt(100000, 1000000)).padStart(6, "0");
  await prisma.verificationToken.create({
    data: { userId: user.id, tokenHash: sha256(`${user.id}:${code}`), type: "EMAIL_OTP", expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sendOtpEmail(email, code);
}

export type VerifyOtpResult =
  | ({ ok: true } & { accessToken: string; refreshToken: string })
  | { ok: false; reason: "invalid-otp" };

export async function verifyOtp(email: string, code: string, tokens: TokenConfig): Promise<VerifyOtpResult> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false, reason: "invalid-otp" };

  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(`${user.id}:${code}`) } });
  if (!record || record.type !== "EMAIL_OTP" || record.usedAt || record.userId !== user.id || record.expiresAt < new Date()) {
    return { ok: false, reason: "invalid-otp" };
  }

  await prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  const pair = await issueTokenPair(user.id, tokens);
  return { ok: true, ...pair };
}

// --- Password reset ---

export async function requestPasswordReset(email: string, baseUrl: string): Promise<void> {
  // Always resolves — never reveal whether the email is registered.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;

  const rawToken = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { userId: user.id, tokenHash: sha256(rawToken), type: "PASSWORD_RESET", expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  await sendPasswordResetEmail(email, `${baseUrl}/auth/reset-password?token=${rawToken}`);
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid-token" | "expired-token" };

export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordResult> {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });

  if (!record || record.type !== "PASSWORD_RESET" || record.usedAt) {
    return { ok: false, reason: "invalid-token" };
  }
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired-token" };

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
  ]);
  return { ok: true };
}
