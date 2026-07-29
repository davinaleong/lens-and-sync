import pino, { type Logger } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

// Redaction paths for fields that must never reach a log line, regardless
// of which object shape they show up nested in - raw image bytes, full
// chat/message content, and any credential/token material
// (`01-security-checklist.md` §11: "never log raw image bytes, full chat
// content, or tokens - log references/IDs instead"). Pino's wildcard (`*`)
// matches exactly one path segment, so common one-level-deep shapes
// (`req.headers.authorization`, `err.token`, a logged object's own
// `.buffer`/`.content` field) are covered without needing to know the full
// path from every call site.
const REDACT_PATHS = [
  "req.headers.authorization",
  "headers.authorization",
  "*.headers.authorization",
  "authorization",
  "*.authorization",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "password",
  "*.password",
  "buffer",
  "*.buffer",
  "imageBuffer",
  "*.imageBuffer",
  "content",
  "*.content",
  "messages",
  "*.messages",
];

export interface CreateLoggerOptions {
  service: string;
  level: LogLevel;
}

// `destination` is only ever overridden by tests (a captured stream instead
// of stdout) - production callers always omit it and get pino's normal
// stdout behavior.
export function createLogger(options: CreateLoggerOptions, destination?: NodeJS.WritableStream): Logger {
  const pinoOptions = {
    name: options.service,
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err },
  };
  return destination ? pino(pinoOptions, destination) : pino(pinoOptions);
}

export type SecurityEventType =
  | "auth-rejected"
  | "upload-rejected"
  | "rate-limited"
  | "moderation-blocked"
  | "not-found";

export interface SecurityEvent {
  type: SecurityEventType;
  route: string;
  reason: string;
  statusCode: number;
  userId?: string;
}

/**
 * One consistent shape for every "expected rejection" log line (401s,
 * 422s, 429s) across both apps, so these are greppable/alertable as a
 * class (`01-security-checklist.md` §11's "log security-relevant events"
 * and §12's "alert on anomalous traffic patterns"). Deliberately takes only
 * `userId`/reason codes/route - never a request body, header value, or
 * anything that could carry image bytes or chat content.
 */
export function logSecurityEvent(logger: Logger, event: SecurityEvent): void {
  logger.warn(
    { event: event.type, route: event.route, reason: event.reason, statusCode: event.statusCode, userId: event.userId },
    `security event: ${event.type}`,
  );
}

export type { Logger };
