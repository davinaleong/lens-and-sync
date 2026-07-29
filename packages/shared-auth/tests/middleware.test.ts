import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { requireAuth, type AuthenticatedRequest } from "../src/middleware.js";

const SECRET = "test-secret";

function mockReqRes(authorizationHeader?: string) {
  const req = {
    headers: { authorization: authorizationHeader },
    method: "POST",
    originalUrl: "/upload",
  } as unknown as AuthenticatedRequest;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, status, json, next };
}

describe("requireAuth", () => {
  it("attaches the verified userId to the request and calls next() for a valid Bearer token", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: "15m" });
    const { req, res, next } = mockReqRes(`Bearer ${token}`);

    requireAuth(SECRET)(req, res, next);

    expect(req.userId).toBe("user-123");
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns a clean 401 and does not call next() when the header is missing", () => {
    const { req, res, status, json, next } = mockReqRes(undefined);

    requireAuth(SECRET)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: { code: "unauthorized", message: "Authentication required." } });
    expect(next).not.toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });

  it("returns the identical 401 shape for an expired token as for a missing one", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: -10 });
    const { req, res, status, json, next } = mockReqRes(`Bearer ${token}`);

    requireAuth(SECRET)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: { code: "unauthorized", message: "Authentication required." } });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer auth scheme", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: "15m" });
    const { req, res, status, next } = mockReqRes(`Basic ${token}`);

    requireAuth(SECRET)(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("logs the internal rejection reason server-side when a logger is supplied, without changing the client response", () => {
    const { req, res, status, json, next } = mockReqRes(undefined);
    const logger = { warn: vi.fn() };

    requireAuth(SECRET, logger)(req, res, next);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth-rejected", reason: "missing", statusCode: 401, route: "POST /upload" }),
      expect.any(String),
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: { code: "unauthorized", message: "Authentication required." } });
  });

  it("never calls the logger on successful verification", () => {
    const token = jwt.sign({ sub: "user-123" }, SECRET, { expiresIn: "15m" });
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    const logger = { warn: vi.fn() };

    requireAuth(SECRET, logger)(req, res, next);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
