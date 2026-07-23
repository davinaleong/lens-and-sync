import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { verifyAccessToken } from "../src/verify.js";

const SECRET = "test-secret";
const OTHER_SECRET = "a-different-secret";

describe("verifyAccessToken", () => {
  it("accepts a validly-signed token and extracts the userId from `sub`", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: "15m" });
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: true, userId: "user-123" });
  });

  it("rejects a missing token", () => {
    const result = verifyAccessToken(undefined, SECRET);
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: -10 });
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "user-123" }, OTHER_SECRET, { expiresIn: "15m" });
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a garbage string that isn't a JWT at all", () => {
    const result = verifyAccessToken("not-a-jwt", SECRET);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a validly-signed token with no `sub` claim", () => {
    const token = jwt.sign({ role: "user" }, SECRET, { expiresIn: "15m" });
    const result = verifyAccessToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
