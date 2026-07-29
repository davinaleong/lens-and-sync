import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, logSecurityEvent } from "../src/index.js";

function captureLines(): { stream: PassThrough; lines: () => Record<string, unknown>[] } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (chunk) => chunks.push(chunk.toString()));
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line)),
  };
}

describe("createLogger", () => {
  it("logs at the configured level, tagged with the service name", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "info" }, stream);

    logger.info({ foo: "bar" }, "hello");

    const [entry] = lines();
    expect(entry.name).toBe("test-service");
    expect(entry.msg).toBe("hello");
    expect(entry.foo).toBe("bar");
  });

  it("suppresses logs below the configured level", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "warn" }, stream);

    logger.info("should not appear");
    logger.warn("should appear");

    const entries = lines();
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("should appear");
  });

  it("redacts an authorization header wherever it appears, never logging the raw token", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "info" }, stream);

    logger.info({ headers: { authorization: "Bearer secret-token-value" } }, "request received");

    const [entry] = lines();
    const headers = entry.headers as Record<string, unknown>;
    expect(headers.authorization).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("secret-token-value");
  });

  it("serializes an err field into a real stack trace, not an empty object", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "info" }, stream);

    logger.error({ err: new Error("boom") }, "unhandled error");

    const [entry] = lines();
    const err = entry.err as Record<string, unknown>;
    expect(err.message).toBe("boom");
    expect(typeof err.stack).toBe("string");
  });

  it("redacts raw image buffers and chat message content, never leaking them into a log line", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "info" }, stream);

    logger.info(
      { upload: { buffer: "base64-image-bytes-should-never-appear", content: "full chat message text" } },
      "processing upload",
    );

    const raw = JSON.stringify(lines()[0]);
    expect(raw).not.toContain("base64-image-bytes-should-never-appear");
    expect(raw).not.toContain("full chat message text");
  });
});

describe("logSecurityEvent", () => {
  it("logs a structured warning with route/reason/status/userId but no request internals", () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ service: "test-service", level: "info" }, stream);

    logSecurityEvent(logger, {
      type: "auth-rejected",
      route: "POST /upload",
      reason: "expired",
      statusCode: 401,
      userId: undefined,
    });

    const [entry] = lines();
    expect(entry.level).toBe(40); // pino warn level
    expect(entry.event).toBe("auth-rejected");
    expect(entry.route).toBe("POST /upload");
    expect(entry.reason).toBe("expired");
    expect(entry.statusCode).toBe(401);
  });
});
