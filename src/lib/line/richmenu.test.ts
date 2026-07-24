import { describe, it, expect, afterEach, vi } from "vitest";
import { linkRichMenuToUser, switchToMemberRichMenu } from "./richmenu";

const KEYS = ["LINE_ENABLED", "LINE_MEMBER_RICHMENU_ID", "LINE_CHANNEL_ACCESS_TOKEN"] as const;
const orig: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (orig[k] === undefined) delete process.env[k];
    else process.env[k] = orig[k];
  }
});

describe("linkRichMenuToUser", () => {
  it("POSTs to the per-user rich-menu endpoint with the bearer token", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await linkRichMenuToUser("Uabc", "rm-1")).ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/user/Uabc/richmenu/rm-1");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("returns an error (no fetch) when the channel token is missing", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await linkRichMenuToUser("U", "r")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx as an error", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    expect((await linkRichMenuToUser("U", "r")).ok).toBe(false);
  });
});

describe("switchToMemberRichMenu — gated + best-effort", () => {
  it("no-ops unless LINE_ENABLED=true AND a member menu id is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.LINE_ENABLED = "false";
    process.env.LINE_MEMBER_RICHMENU_ID = "m1";
    await switchToMemberRichMenu("U");

    process.env.LINE_ENABLED = "true";
    delete process.env.LINE_MEMBER_RICHMENU_ID;
    await switchToMemberRichMenu("U");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links the member menu when enabled + configured", async () => {
    process.env.LINE_ENABLED = "true";
    process.env.LINE_MEMBER_RICHMENU_ID = "m1";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await switchToMemberRichMenu("Uabc");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.line.me/v2/bot/user/Uabc/richmenu/m1");
  });

  it("never throws when the API call fails", async () => {
    process.env.LINE_ENABLED = "true";
    process.env.LINE_MEMBER_RICHMENU_ID = "m1";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    await expect(switchToMemberRichMenu("U")).resolves.toBeUndefined();
  });
});
