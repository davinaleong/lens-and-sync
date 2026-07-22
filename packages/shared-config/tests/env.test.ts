import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commaSeparated, loadEnv, logLevelSchema, nodeEnvSchema } from "../src/env.js";

describe("loadEnv", () => {
  const schema = z.object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    API_KEY: z.string().min(1),
  });

  it("parses a valid environment and applies defaults", () => {
    const config = loadEnv(schema, { API_KEY: "secret" });

    expect(config).toEqual({
      PORT: 4000,
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      API_KEY: "secret",
    });
  });

  it("coerces and overrides provided values", () => {
    const config = loadEnv(schema, {
      PORT: "8080",
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
      API_KEY: "secret",
    });

    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe("production");
    expect(config.LOG_LEVEL).toBe("debug");
  });

  it("throws a readable error listing every missing/invalid key", () => {
    expect(() => loadEnv(schema, { NODE_ENV: "not-a-real-env" })).toThrowError(
      /API_KEY[\s\S]*NODE_ENV|NODE_ENV[\s\S]*API_KEY/,
    );
  });
});

describe("commaSeparated", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(commaSeparated.parse("a, b ,,c")).toEqual(["a", "b", "c"]);
  });

  it("returns a single-item array for one value", () => {
    expect(commaSeparated.parse("http://localhost:3000")).toEqual(["http://localhost:3000"]);
  });
});
