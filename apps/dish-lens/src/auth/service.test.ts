import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};

vi.mock("@lens-and-sync/shared-db", () => ({ prisma: prismaMock }));

const { loginUser, refreshTokens, registerUser, revokeRefreshToken } = await import("./service.js");

const TOKENS = {
  accessSecret: "access-secret",
  refreshSecret: "refresh-secret",
  accessTtl: "15m",
  refreshTtl: "30d",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.refreshToken.create.mockResolvedValue({});
});

describe("registerUser", () => {
  it("creates a user and issues a token pair when the email is new", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "user-1", email: "a@example.com" });

    const result = await registerUser("a@example.com", "correct horse battery staple", TOKENS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
    }
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { email: "a@example.com", passwordHash: expect.any(String) },
    });
    expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
      data: { userId: "user-1", tokenHash: expect.any(String) },
    });
  });

  it("rejects registration when the email is already taken", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@example.com" });

    const result = await registerUser("a@example.com", "correct horse battery staple", TOKENS);

    expect(result).toEqual({ ok: false, reason: "email-in-use" });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe("loginUser", () => {
  it("issues a token pair for a correct password", async () => {
    const { hashPassword } = await import("./hash.js");
    const passwordHash = await hashPassword("correct horse battery staple");
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@example.com", passwordHash });

    const result = await loginUser("a@example.com", "correct horse battery staple", TOKENS);

    expect(result.ok).toBe(true);
  });

  it("rejects an unknown email with the same generic reason as a wrong password", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await loginUser("nobody@example.com", "whatever", TOKENS);

    expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
  });

  it("rejects a wrong password", async () => {
    const { hashPassword } = await import("./hash.js");
    const passwordHash = await hashPassword("correct horse battery staple");
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@example.com", passwordHash });

    const result = await loginUser("a@example.com", "wrong password", TOKENS);

    expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
  });
});

describe("refreshTokens", () => {
  it("rotates a valid, unrevoked refresh token into a new pair", async () => {
    const { signToken } = await import("@lens-and-sync/shared-auth");
    const refreshToken = signToken("user-1", TOKENS.refreshSecret, TOKENS.refreshTtl);
    prismaMock.refreshToken.findUnique.mockResolvedValue({ id: "row-1", userId: "user-1", revokedAt: null });
    prismaMock.refreshToken.update.mockResolvedValue({});

    const result = await refreshTokens(refreshToken, TOKENS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.refreshToken).not.toBe(refreshToken);
    }
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rejects an expired refresh token without touching the database", async () => {
    const { signToken } = await import("@lens-and-sync/shared-auth");
    const refreshToken = signToken("user-1", TOKENS.refreshSecret, "-10s");

    const result = await refreshTokens(refreshToken, TOKENS);

    expect(result).toEqual({ ok: false, reason: "invalid-refresh-token" });
    expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a revoked (already-rotated) refresh token", async () => {
    const { signToken } = await import("@lens-and-sync/shared-auth");
    const refreshToken = signToken("user-1", TOKENS.refreshSecret, TOKENS.refreshTtl);
    prismaMock.refreshToken.findUnique.mockResolvedValue({ id: "row-1", userId: "user-1", revokedAt: new Date() });

    const result = await refreshTokens(refreshToken, TOKENS);

    expect(result).toEqual({ ok: false, reason: "invalid-refresh-token" });
  });

  it("rejects a refresh token signed for a different user than the stored row", async () => {
    const { signToken } = await import("@lens-and-sync/shared-auth");
    const refreshToken = signToken("user-1", TOKENS.refreshSecret, TOKENS.refreshTtl);
    prismaMock.refreshToken.findUnique.mockResolvedValue({ id: "row-1", userId: "user-2", revokedAt: null });

    const result = await refreshTokens(refreshToken, TOKENS);

    expect(result).toEqual({ ok: false, reason: "invalid-refresh-token" });
  });
});

describe("revokeRefreshToken", () => {
  it("marks the matching, not-yet-revoked row as revoked", async () => {
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await revokeRefreshToken("some-refresh-token");

    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
