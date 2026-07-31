import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { classifyRequest, logApiRequest, loggingEnabled } from "@/lib/proxy-log";

// Single entry point for activity logging. Replaces the per-route withApiLog()
// wrapper: anything added under src/app/api/** is recorded automatically, so a new
// endpoint can't ship unlogged because someone forgot to wrap it.
//
// Also records page views. The CRM's pages are Server Components that query Postgres
// directly, so there is no API request behind loading /leads or /board — logging the
// navigation itself is the only way to see them. classifyRequest() decides what
// counts; prefetches and Server Action POSTs are filtered out there, not here.
//
// Runs on the Node.js runtime — Next 16's default for proxy, and required here since
// the audit write goes through Prisma + the pg adapter. Setting `runtime` in a proxy
// file is an error, so there is deliberately no runtime export below.
//
// The matcher excludes Next internals and static assets up front so the proxy isn't
// invoked for every stylesheet and image; classifyRequest() re-checks in case this
// pattern is ever loosened.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|gif|webp|ico|css|js|map|txt|xml|woff2?)$).*)"],
};

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = NextResponse.next();

  if (!loggingEnabled()) return response;

  const kind = classifyRequest(request.nextUrl.pathname, request.method);
  if (!kind) return response;

  // waitUntil keeps the write off the response path while still holding the runtime
  // open until it settles — the proxy equivalent of the wrapper's after() call.
  // logApiRequest never rejects, so this can't produce an unhandled rejection.
  event.waitUntil(logApiRequest(request, kind));

  return response;
}
