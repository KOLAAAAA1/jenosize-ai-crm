import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { registerLiffContact, findLiffContact, SELF_REGISTERED_COMPANY } from "./liff-register";
import { verifyLiffIdToken, loginChannelId } from "./liff-verify";

const TEST_USER_ID = "Utest_liff_reg_000000000000000000000001";

let dbOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
});

afterAll(async () => {
  if (dbOk) await prisma.contact.deleteMany({ where: { lineUserId: TEST_USER_ID } }).catch(() => {});
});

describe("registerLiffContact", () => {
  it("creates a contact under the sentinel company on first registration", async (ctx) => {
    if (!dbOk) ctx.skip();
    await prisma.contact.deleteMany({ where: { lineUserId: TEST_USER_ID } });

    const res = await registerLiffContact(prisma, {
      userId: TEST_USER_ID,
      firstName: "สมชาย",
      lastName: "ใจดี",
      email: "somchai@example.com",
      phone: "0812345678",
      consent: true,
    });

    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);

    const contact = await prisma.contact.findUnique({
      where: { lineUserId: TEST_USER_ID },
      include: { company: { select: { name: true } } },
    });
    expect(contact?.firstName).toBe("สมชาย");
    expect(contact?.consentStatus).toBe("OPTED_IN");
    expect(contact?.company.name).toBe(SELF_REGISTERED_COMPANY);
  });

  it("re-submit updates the same contact (no duplicate) and honors the consent box", async (ctx) => {
    if (!dbOk) ctx.skip();

    const res = await registerLiffContact(prisma, {
      userId: TEST_USER_ID,
      firstName: "สมชาย",
      lastName: "ใจงาม",
      email: null,
      phone: "0899999999",
      consent: false,
    });
    expect(res.created).toBe(false);

    const rows = await prisma.contact.findMany({ where: { lineUserId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lastName).toBe("ใจงาม");
    expect(rows[0].phone).toBe("0899999999");
    expect(rows[0].consentStatus).toBe("UNKNOWN");
  });
});

describe("findLiffContact", () => {
  it("returns null for an unknown LINE user, and the linked contact once registered", async (ctx) => {
    if (!dbOk) ctx.skip();
    expect(await findLiffContact(prisma, "Uunknown_liff_zzz_000")).toBeNull();

    await registerLiffContact(prisma, { userId: TEST_USER_ID, firstName: "หา", lastName: "เจอ", email: "found@example.com", phone: null, consent: true });
    const c = await findLiffContact(prisma, TEST_USER_ID);
    expect(c?.firstName).toBe("หา");
    expect(c?.email).toBe("found@example.com");
    expect(c?.consentStatus).toBe("OPTED_IN");
  });
});

describe("loginChannelId", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = orig.LINE_LOGIN_CHANNEL_ID;
    process.env.LINE_LIFF_ID = orig.LINE_LIFF_ID;
  });

  it("derives the channel id from the LIFF id prefix", () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    process.env.LINE_LIFF_ID = "2010774468-0ye7QV45";
    expect(loginChannelId()).toBe("2010774468");
  });

  it("prefers an explicit LINE_LOGIN_CHANNEL_ID", () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "9999999999";
    process.env.LINE_LIFF_ID = "2010774468-0ye7QV45";
    expect(loginChannelId()).toBe("9999999999");
  });
});

describe("verifyLiffIdToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the trusted userId + name on a 200 verify", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sub: "Uverified123", name: "Nok" }), { status: 200 })));
    const res = await verifyLiffIdToken("tok", "2010774468");
    expect(res).toEqual({ userId: "Uverified123", displayName: "Nok" });
  });

  it("returns null when LINE rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 })));
    expect(await verifyLiffIdToken("bad", "2010774468")).toBeNull();
  });

  it("returns null when the response lacks a sub claim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "no-sub" }), { status: 200 })));
    expect(await verifyLiffIdToken("tok", "2010774468")).toBeNull();
  });
});
