type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

const REDACTED_FIELD = /(authorization|password|secret|token|api[_-]?key|access[_-]?key)/i;

function sanitize(fields: LogFields): Record<string, Exclude<LogValue, undefined>> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, REDACTED_FIELD.test(key) ? "[redacted]" : value as Exclude<LogValue, undefined>]),
  );
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  if (process.env.NODE_ENV === "test" && process.env.LOG_IN_TESTS !== "true") return;

  const entry = {
    level,
    event,
    at: new Date().toISOString(),
    ...sanitize(fields),
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
