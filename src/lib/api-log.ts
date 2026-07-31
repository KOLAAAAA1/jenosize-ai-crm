// Framework-agnostic request-log helpers (no next/* or server-only imports), so
// redaction, device classification and IP extraction are directly unit-testable.
// The Next-bound proxy logger lives in ./proxy-log and builds on this module.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Serialized-payload ceiling. Big enough for every real request this API takes
// (LINE webhook batches are the largest), small enough that the table stays cheap.
export const MAX_PAYLOAD_BYTES = 8 * 1024;
// Bodies larger than this are never read into memory at all.
export const MAX_BODY_READ_BYTES = 64 * 1024;
// Guards against pathological nesting (and cyclic structures via depth exhaustion).
const MAX_DEPTH = 8;

export const REDACTED = "[redacted]";

// Same policy as logger.ts, extended for the credentials this API actually
// receives: LINE `idToken`, the signed connect `token`, webhook signatures.
const REDACTED_FIELD = /(authorization|password|secret|token|api[_-]?key|access[_-]?key|signature|cookie)/i;

// Recursive — unlike logger.ts's flat sanitize(), request payloads are nested
// ({ contact: { idToken } }), and a top-level-only scrub would leak them.
export function redactDeep(value: unknown, depth = 0): JsonValue {
  if (depth > MAX_DEPTH) return "[depth-limited]";
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value as JsonValue;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (t !== "object") return String(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      REDACTED_FIELD.test(key) ? REDACTED : redactDeep(val, depth + 1),
    ]),
  );
}

// Only JSON bodies are stored: everything this API accepts is JSON, and blindly
// buffering (say) a multipart upload into a Json column is how audit tables become
// the biggest thing in the database.
export function capturePayload(contentType: string | null, rawBody: string | null, skipped?: string | null): JsonValue | null {
  if (skipped) return { _skipped: skipped };
  if (rawBody == null || rawBody === "") return null;
  if (!contentType?.toLowerCase().includes("application/json")) {
    return { _skipped: "unsupported-content-type", contentType: contentType ?? "unknown", bytes: rawBody.length };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { _skipped: "invalid-json", bytes: rawBody.length };
  }

  const redacted = redactDeep(parsed);
  const serialized = JSON.stringify(redacted) ?? "null";
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return { _truncated: true, bytes: serialized.length, preview: serialized.slice(0, MAX_PAYLOAD_BYTES) };
  }
  return redacted;
}

export function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// Query strings can carry tokens too (e.g. a connect link), so they get the same
// key-level redaction as the body.
export function captureQuery(url: string): JsonValue | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const entries = [...params.entries()];
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([k, v]) => [k, REDACTED_FIELD.test(k) ? REDACTED : v]));
}

// Coarse buckets only — enough to answer "was this a phone or a server?" without
// pretending to be a UA-parsing library. Order matters: iPad's UA also says "Mobile".
export function classifyDevice(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/bot|crawler|spider|curl|wget|postman|insomnia|python-requests|axios|node-fetch|okhttp|go-http/.test(ua)) return "bot";
  if (/ipad|tablet|playbook|silk|kindle|android(?!.*mobi)/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|windows phone|line\//.test(ua)) return "mobile";
  return "desktop";
}

// Vercel puts the real client IP first in x-forwarded-for; the rest of the chain is
// proxy hops and is not worth storing.
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? null;
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export type RequestLogInput = {
  method: string;
  url: string;
  headers: Headers;
  rawBody: string | null;
  bodySkipped?: string | null;
};

export type RequestLog = {
  path: string;
  method: string;
  query: JsonValue | null;
  payload: JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  device: string;
};

// Everything the log row needs from the *request*, captured synchronously before the
// handler runs — the body stream is gone by the time the after() callback fires.
export function buildRequestLog({ method, url, headers, rawBody, bodySkipped }: RequestLogInput): RequestLog {
  const userAgent = headers.get("user-agent");
  return {
    path: pathFromUrl(url),
    method,
    query: captureQuery(url),
    payload: capturePayload(headers.get("content-type"), rawBody, bodySkipped),
    ipAddress: clientIp(headers),
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    device: classifyDevice(userAgent),
  };
}
