type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /secret|password|passwd|token|authorization|cookie|api[-_]?key|session/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value === null || typeof value !== "object") return value;
  // Never print what was not inspected for secrets (also keeps a cyclic object from breaking JSON.stringify).
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
  );
}

/** One JSON object per line (stdout for info, stderr otherwise). Stack traces stay out: they are not needed to act on a log line. */
export function formatLog(level: Level, message: string, fields: Fields = {}, now = new Date()): string {
  // The envelope goes last so a caller's field named "message" or "level" cannot overwrite it.
  return JSON.stringify({ ...(redact(fields) as Fields), time: now.toISOString(), level, message });
}

function write(level: Level, message: string, fields?: Fields): void {
  const line = formatLog(level, message, fields) + "\n";
  (level === "info" ? process.stdout : process.stderr).write(line);
}

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
