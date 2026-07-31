import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";
import { logger } from "./logger";
import { buildRequestLog, cookieValue, MAX_BODY_READ_BYTES, type RequestLog } from "./api-log";

// The audit write behind src/proxy.ts. Every request under /api/** lands in
// ActivityLog without the route having to opt in — which is the whole point of
// moving off the old per-route withApiLog() wrapper: a new endpoint is logged the
// moment it exists, and nobody has to remember anything.
//
// What this deliberately cannot record: `statusCode` and `durationMs`. Next's proxy
// runs before the request completes and has no continuation hook, so the handler's
// response is never visible here. Both columns are nullable and stay null.
//
// Two invariants carried over from the wrapper:
//   1. Never break the request — everything is try/caught down to a logger.warn.
//   2. Never block the response — the caller runs this inside event.waitUntil().

// Mirrors logger.ts: tests run against a real local Postgres, and unit tests that
// invoke a route handler directly shouldn't need the audit table to exist.
export function loggingEnabled(): boolean {
  if (process.env.API_ACTIVITY_LOG === "false") return false;
  if (process.env.NODE_ENV === "test") return process.env.API_ACTIVITY_LOG === "true";
  return true;
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

// Anything the browser fetches as a resource rather than navigates to. The matcher in
// proxy.ts already excludes most of these; this is the belt-and-braces pass so a
// matcher edit can't silently fill the table with asset requests.
const ASSET_PATH = /^\/(_next\/|favicon\.ico$)|\.(?:png|jpe?g|svg|gif|webp|ico|css|js|map|txt|xml|woff2?)$/;

export type LogKind = "api" | "page";

// Decides whether a request is worth a row, and what kind. Returning null means skip.
//
// IMPORTANT — measured, not assumed: Next strips its own routing headers before the
// proxy runs. A header dump at this point yields only accept / host / user-agent /
// x-forwarded-*; `rsc`, `next-router-prefetch` and `next-action` are all absent here,
// even though Route Handlers do receive them. So this function CANNOT tell a prefetch,
// an RSC client-side navigation, and a full page load apart. Don't add checks for
// those headers — they silently never match.
//
// What survives the constraint:
//   - Server Action POSTs target the page URL, and while `next-action` is invisible
//     here, they are POSTs — so the GET check below still excludes them. Auditing
//     mutations properly means wrapping the action functions, not this.
//   - Prefetches were measured as NOT reaching the proxy at all (production build,
//     real browser, viewport + hover): zero rows. So they are not a noise source.
//
// Known limitation this leaves behind: one client-side navigation can produce more
// than one logged request, so page-view counts skew high. See docs/04_Database.md.
export function classifyRequest(pathname: string, method: string): LogKind | null {
  if (isApiPath(pathname)) return "api";
  if (ASSET_PATH.test(pathname)) return null;
  if (method !== "GET") return null;
  return "page";
}

export async function logApiRequest(req: Request, kind: LogKind = "api"): Promise<void> {
  try {
    const captured = await captureRequest(req);
    const sessionToken = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
    await persist(captured, sessionToken, kind);
  } catch (err) {
    // A logging failure must never surface to the caller.
    logger.warn("api.activity_log.failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function captureRequest(req: Request): Promise<RequestLog> {
  const headers = req.headers;
  try {
    const { rawBody, bodySkipped } = await readBody(req);
    return buildRequestLog({ method: req.method, url: req.url, headers, rawBody, bodySkipped });
  } catch (err) {
    // A body that can't be read must not cost us the rest of the row.
    logger.warn("api.activity_log.capture_failed", { error: err instanceof Error ? err.message : String(err) });
    return buildRequestLog({ method: req.method, url: req.url, headers, rawBody: null, bodySkipped: "capture-failed" });
  }
}

async function readBody(req: Request): Promise<{ rawBody: string | null; bodySkipped: string | null }> {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return { rawBody: null, bodySkipped: null };

  const header = req.headers.get("content-length");
  const declared = header == null || header === "" ? null : Number(header);
  if (declared != null && Number.isFinite(declared) && declared > MAX_BODY_READ_BYTES) {
    return { rawBody: null, bodySkipped: "body-too-large" };
  }

  // clone() first, and never read `req` itself. Next does buffer the body when a
  // proxy is present (see `proxyClientMaxBodySize`) so both this and the route
  // handler can read it, but a bare req.text() still consumes the stream under plain
  // fetch semantics — which is what the unit tests exercise. Reading only the clone
  // is correct under both. Load-bearing: the LINE webhook HMACs the exact raw bytes,
  // so a consumed body there would fail every signature check.
  const rawBody = await req.clone().text();
  if (rawBody.length > MAX_BODY_READ_BYTES) return { rawBody: null, bodySkipped: "body-too-large" };
  return { rawBody, bodySkipped: null };
}

async function persist(captured: RequestLog, sessionToken: string | null, kind: LogKind): Promise<void> {
  try {
    // Resolved from the *request* cookie, so POST /api/auth/login always records
    // userId: null (no session existed when it arrived) while POST /api/auth/logout
    // still attributes to the user who sent it. That is the intended reading.
    const user = sessionToken ? await verifySession(sessionToken) : null;
    const { query, payload, ...rest } = captured;
    await prisma.activityLog.create({
      data: {
        ...rest,
        kind,
        // Prisma distinguishes SQL NULL from JSON null on Json? columns.
        query: query ?? Prisma.DbNull,
        payload: payload ?? Prisma.DbNull,
        userId: user?.id ?? null,
      },
    });
  } catch (err) {
    logger.warn("api.activity_log.write_failed", {
      path: captured.path,
      method: captured.method,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
