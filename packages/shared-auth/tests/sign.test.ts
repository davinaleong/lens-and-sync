import { describe, expect, it } from "vitest";
import { signToken } from "../src/sign.js";
import { verifyAccessToken } from "../src/verify.js";

const SECRET = "test-secret";

describe("signToken", () => {
  it("produces a token verifyAccessToken accepts, round-tripping the userId", () => {
    const token = signToken("user-123", SECRET, "15m");
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: true, userId: "user-123" });
  });

  it("produces a token that expires per the given ttl", () => {
    const token = signToken("user-123", SECRET, "-10s");
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("produces a token only valid against the secret it was signed with", () => {
    const token = signToken("user-123", SECRET, "15m");
    const result = verifyAccessToken(token, "a-different-secret");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("produces distinct tokens for the same user signed back-to-back", () => {
    const a = signToken("user-123", SECRET, "15m");
    const b = signToken("user-123", SECRET, "15m");
    expect(a).not.toBe(b);
  });
});
