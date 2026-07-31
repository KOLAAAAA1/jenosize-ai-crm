import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signSession, SESSION_COOKIE } from "@/lib/session";

// Logging is off by default under NODE_ENV=test (see loggingEnabled) — this suite is
// the one place that turns it on, and it puts it back afterwards so no other suite
// starts writing rows against a real database.
const priorSetting = process.env.API_ACTIVITY_LOG;
process.env.API_ACTIVITY_LOG = "true";
afterAll(() => {
  if (priorSetting === undefined) delete process.env.API_ACTIVITY_LOG;
  else process.env.API_ACTIVITY_LOG = priorSetting;
});

const create = vi.fn().mockResolvedValue({ id: "log_1" });
vi.mock("@/lib/db", () => ({ prisma: { activityLog: { create: (args: unknown) => create(args) } } }));

const { logApiRequest, isApiPath, loggingEnabled, classifyRequest } = await import("@/lib/proxy-log");



function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://crm.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => create.mockClear());

describe("isApiPath", () => {
  it("matches only API paths, so page requests are classified as pages not api", () => {
    expect(isApiPath("/api/me")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/leads")).toBe(false);
    expect(isApiPath("/")).toBe(false);
    // A page route that merely starts with the same letters must not match.
    expect(isApiPath("/apidocs")).toBe(false);
  });
});

describe("classifyRequest", () => {
  it("classifies API requests regardless of method", () => {
    expect(classifyRequest("/api/me", "GET")).toBe("api");
    expect(classifyRequest("/api/auth/login", "POST")).toBe("api");
  });

  it("classifies the CRM pages the audit trail is meant to cover", () => {
    for (const p of ["/", "/leads", "/board", "/tasks", "/companies", "/contacts"]) {
      expect(classifyRequest(p, "GET")).toBe("page");
    }
  });

  // Server Actions POST to the page URL. The `next-action` header is stripped before
  // the proxy sees it, so the method check is the only thing excluding them — which
  // makes this assertion load-bearing rather than incidental.
  it("excludes Server Action POSTs via the method check", () => {
    expect(classifyRequest("/leads/led_1", "POST")).toBeNull();
    expect(classifyRequest("/", "POST")).toBeNull();
  });

  it("ignores static assets", () => {
    expect(classifyRequest("/_next/static/chunk.js", "GET")).toBeNull();
    expect(classifyRequest("/icon.png", "GET")).toBeNull();
    expect(classifyRequest("/favicon.ico", "GET")).toBeNull();
    expect(classifyRequest("/apple-icon.png", "GET")).toBeNull();
  });
});

describe("loggingEnabled", () => {
  it("is opt-in under test and can be switched off explicitly", () => {
    expect(loggingEnabled()).toBe(true); // API_ACTIVITY_LOG=true, set above

    process.env.API_ACTIVITY_LOG = "false";
    expect(loggingEnabled()).toBe(false);

    process.env.API_ACTIVITY_LOG = "true";
  });
});

describe("logApiRequest", () => {
  it("writes one redacted row per request", async () => {
    await logApiRequest(
      post({ email: "a@b.com", password: "hunter2" }, { "x-forwarded-for": "203.0.113.5", "user-agent": "curl/8.4.0" }),
    );

    expect(create).toHaveBeenCalledOnce();
    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      path: "/api/auth/login",
      method: "POST",
      ipAddress: "203.0.113.5",
      device: "bot",
      userId: null,
      payload: { email: "a@b.com", password: "[redacted]" },
    });
  });

  it("stamps the kind so page rows stay separable from API rows", async () => {
    await logApiRequest(post({ a: 1 }), "api");
    expect((create.mock.calls[0][0] as { data: { kind: string } }).data.kind).toBe("api");

    create.mockClear();
    await logApiRequest(new Request("https://crm.test/leads?stage=NEW"), "page");
    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.kind).toBe("page");
    expect(data.path).toBe("/leads");
    // Query strings survive, so "who filtered the board by stage" is answerable.
    expect(data.query).toEqual({ stage: "NEW" });
  });

  it("records no statusCode or durationMs — the proxy never sees the response", async () => {
    await logApiRequest(post({ a: 1 }));

    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.statusCode).toBeUndefined();
    expect(data.durationMs).toBeUndefined();
  });

  it("attributes the row to the session user when the request carries a session cookie", async () => {
    const token = await signSession({ id: "usr_9", email: "s@b.com", name: "Sam", role: "SALES" });

    await logApiRequest(post({ leadId: "led_1" }, { cookie: `${SESSION_COOKIE}=${token}` }));

    const { data } = create.mock.calls[0][0] as { data: { userId: string | null } };
    expect(data.userId).toBe("usr_9");
  });

  it("leaves the body readable afterwards, so the route handler still gets it", async () => {
    // Load-bearing for the LINE webhook, which HMACs the exact raw bytes.
    const req = post({ hello: "world" });

    await logApiRequest(req);

    expect(await req.clone().json()).toEqual({ hello: "world" });
  });

  it("never throws when the log write fails", async () => {
    create.mockRejectedValueOnce(new Error("db down"));

    await expect(logApiRequest(post({ a: 1 }))).resolves.toBeUndefined();
  });

  it("skips a body that exceeds the read ceiling instead of buffering it", async () => {
    const req = new Request("https://crm.test/api/line/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(65 * 1024) },
      body: JSON.stringify({ big: "x" }),
    });

    await logApiRequest(req);

    const { data } = create.mock.calls[0][0] as { data: { payload: unknown } };
    expect(data.payload).toEqual({ _skipped: "body-too-large" });
  });
});
