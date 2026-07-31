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

// Parses a JSON object from an env var string. Accepts three formats so the
// caller can use whichever survives their platform's env var handling:
//   1. Raw JSON:            {"type":"service_account",...}
//   2. Quote-wrapped JSON:  "{"type":"service_account",...}"  (Railway, Docker env_file)
//   3. Base64-encoded JSON: eyJ0eXBlIjoic2Vy...  (most reliable for multi-line secrets)
export const jsonObject = z.string().min(1).transform((s, ctx) => {
  const raw = s.trim();

  const tryParse = (v: string): Record<string, unknown> | null => {
    try {
      const val = JSON.parse(v);
      return val !== null && typeof val === "object" && !Array.isArray(val)
        ? (val as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  let result = tryParse(raw);
  if (result) return result;

  if (raw[0] === '"' || raw[0] === "'") {
    result = tryParse(raw.endsWith(raw[0]) ? raw.slice(1, -1) : raw.slice(1));
    if (result) return result;
  }

  try {
    result = tryParse(Buffer.from(raw, "base64").toString("utf8"));
    if (result) return result;
  } catch { /* not base64 */ }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Must be a valid JSON object, optionally quote-wrapped or base64-encoded",
  });
  return z.NEVER;
});
