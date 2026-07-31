import { z } from "zod";

export function loadEnv<Schema extends z.ZodTypeAny>(
  schema: Schema,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const commaSeparated = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace"])
  .default("info");

// Parses a JSON object from a string, stripping a wrapping/leading quote that
// some platforms (Railway, Docker env_file) add around multi-line env var values.
export const jsonObject = z.string().min(1).transform((s) => {
  let raw = s.trim();
  if (raw[0] === '"' || raw[0] === "'") raw = raw.endsWith(raw[0]) ? raw.slice(1, -1) : raw.slice(1);
  return JSON.parse(raw) as Record<string, unknown>;
});
