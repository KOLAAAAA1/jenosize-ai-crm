import { describe, it, expect } from "vitest";
import {
  redactDeep,
  capturePayload,
  captureQuery,
  classifyDevice,
  clientIp,
  cookieValue,
  buildRequestLog,
  pathFromUrl,
  REDACTED,
  MAX_PAYLOAD_BYTES,
} from "@/lib/api-log";

describe("redactDeep", () => {
  it("scrubs secret-ish keys at the top level", () => {
    expect(redactDeep({ email: "a@b.com", password: "hunter2" })).toEqual({ email: "a@b.com", password: REDACTED });
  });

  it("scrubs nested and array-nested secrets", () => {
    const out = redactDeep({
      user: { profile: { idToken: "eyJ..." } },
      events: [{ signature: "abc", text: "hi" }],
    });
    expect(out).toEqual({
      user: { profile: { idToken: REDACTED } },
      events: [{ signature: REDACTED, text: "hi" }],
    });
  });

  it("keeps non-secret primitives intact", () => {
    expect(redactDeep({ n: 1, b: true, s: "x", nil: null })).toEqual({ n: 1, b: true, s: "x", nil: null });
  });

  it("stops at the depth limit instead of recursing forever", () => {
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    expect(() => JSON.stringify(redactDeep(cyclic))).not.toThrow();
  });
});

describe("capturePayload", () => {
  it("returns null when there is no body", () => {
    expect(capturePayload("application/json", null)).toBeNull();
    expect(capturePayload("application/json", "")).toBeNull();
  });

  it("parses and redacts a JSON body", () => {
    expect(capturePayload("application/json; charset=utf-8", '{"email":"a@b.com","password":"p"}')).toEqual({
      email: "a@b.com",
      password: REDACTED,
    });
  });

  it("refuses non-JSON content types rather than buffering them", () => {
    const out = capturePayload("multipart/form-data; boundary=x", "----x") as Record<string, unknown>;
    expect(out._skipped).toBe("unsupported-content-type");
  });

  it("marks unparseable JSON instead of throwing", () => {
    const out = capturePayload("application/json", "{not json") as Record<string, unknown>;
    expect(out._skipped).toBe("invalid-json");
  });

  it("truncates oversized payloads", () => {
    const big = JSON.stringify({ note: "x".repeat(MAX_PAYLOAD_BYTES + 500) });
    const out = capturePayload("application/json", big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(String(out.preview)).toHaveLength(MAX_PAYLOAD_BYTES);
  });

  it("propagates a skip reason from the caller", () => {
    expect(capturePayload("application/json", null, "body-too-large")).toEqual({ _skipped: "body-too-large" });
  });
});

describe("captureQuery / pathFromUrl", () => {
  it("extracts the pathname without host or query", () => {
    expect(pathFromUrl("https://crm.example.com/api/me?x=1")).toBe("/api/me");
  });

  it("returns null when there are no search params", () => {
    expect(captureQuery("https://x.test/api/me")).toBeNull();
  });

  it("redacts secret-ish query keys", () => {
    expect(captureQuery("https://x.test/api/line/liff-connect?token=abc&stage=WON")).toEqual({
      token: REDACTED,
      stage: "WON",
    });
  });
});

describe("classifyDevice", () => {
  it("classifies desktop browsers", () => {
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("desktop");
  });

  it("classifies phones", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148")).toBe("mobile");
  });

  it("classifies iPad as tablet even though its UA says Mobile", () => {
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe("tablet");
  });

  it("classifies server-side callers as bots", () => {
    expect(classifyDevice("LineBotWebhook/2.0")).toBe("bot");
    expect(classifyDevice("curl/8.4.0")).toBe("bot");
  });

  it("returns unknown when the header is absent", () => {
    expect(classifyDevice(null)).toBe("unknown");
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIp(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("returns null when no forwarding header is present", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("cookieValue", () => {
  it("finds a cookie among several", () => {
    expect(cookieValue("theme=dark; crm_session=abc.def; other=1", "crm_session")).toBe("abc.def");
  });

  it("returns null when absent or headerless", () => {
    expect(cookieValue("theme=dark", "crm_session")).toBeNull();
    expect(cookieValue(null, "crm_session")).toBeNull();
  });
});

describe("buildRequestLog", () => {
  it("assembles a complete row from a request", () => {
    const headers = new Headers({
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148",
      "x-forwarded-for": "203.0.113.9",
    });
    const log = buildRequestLog({
      method: "POST",
      url: "https://crm.example.com/api/auth/login?next=/leads",
      headers,
      rawBody: '{"email":"a@b.com","password":"p"}',
    });

    expect(log).toEqual({
      path: "/api/auth/login",
      method: "POST",
      query: { next: "/leads" },
      payload: { email: "a@b.com", password: REDACTED },
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148",
      device: "mobile",
    });
  });

  it("records a GET with no body as a null payload", () => {
    const log = buildRequestLog({ method: "GET", url: "https://x.test/api/me", headers: new Headers(), rawBody: null });
    expect(log.payload).toBeNull();
    expect(log.method).toBe("GET");
    expect(log.device).toBe("unknown");
  });

  it("caps a hostile user-agent header", () => {
    const log = buildRequestLog({
      method: "GET",
      url: "https://x.test/api/me",
      headers: new Headers({ "user-agent": "A".repeat(5000) }),
      rawBody: null,
    });
    expect(log.userAgent).toHaveLength(512);
  });
});
