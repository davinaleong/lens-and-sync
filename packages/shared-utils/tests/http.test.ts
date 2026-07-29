import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createFallbackErrorHandler, enforceHttps, notFoundHandler } from "../src/http.js";

function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

describe("enforceHttps", () => {
  it("allows plain HTTP through outside production", () => {
    const req = { secure: false } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    enforceHttps("development")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a secure request through in production", () => {
    const req = { secure: true } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    enforceHttps("production")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a plain HTTP request in production with a 403, never calling next()", () => {
    const req = { secure: false } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    enforceHttps("production")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("notFoundHandler", () => {
  it("returns a JSON 404, not Express's default HTML page", () => {
    const res = mockRes();

    notFoundHandler()({} as Request, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("createFallbackErrorHandler", () => {
  it("logs the error and returns a generic JSON 500 without leaking details", () => {
    const logger = { error: vi.fn() };
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    createFallbackErrorHandler(logger as never)(new Error("SyntaxError: Unexpected token in JSON"), {} as Request, res, next);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("maps a body-parser-style 4xx error (e.g. malformed JSON) to its real status, not a blanket 500", () => {
    const logger = { error: vi.fn() };
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    const bodyParserError = Object.assign(new SyntaxError("Unexpected token in JSON"), { status: 400, type: "entity.parse.failed" });

    createFallbackErrorHandler(logger as never)(bodyParserError, {} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("defers to next() instead of double-responding if headers were already sent", () => {
    const logger = { error: vi.fn() };
    const res = { headersSent: true, status: vi.fn() } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    createFallbackErrorHandler(logger as never)(new Error("boom"), {} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
