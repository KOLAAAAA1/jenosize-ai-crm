import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processFollowLifecycle } from "./follow";
import type { LineSendResult } from "./adapter";

const EXISTING = "Ufollowtest_existing_00000000000001";
const NEWUSER = "Ufollowtest_newuser_000000000000002";
const ids = { company: "test_cmp_follow", contact: "test_con_follow" };
const LIFF_URL = "https://liff.line.me/2010774468-0ye7QV45";

const okReply = async (): Promise<LineSendResult> => ({ ok: true, providerMessageId: "mock", mode: "mock", requestId: null });

function body(events: unknown[]): string {
  return JSON.stringify({ destination: "U-oa", events });
}
const followEvent = (userId: string) => ({ type: "follow", replyToken: `rt-${userId}`, source: { type: "user", userId } });
const unfollowEvent = (userId: string) => ({ type: "unfollow", source: { type: "user", userId } });

let dbOk = false;

async function cleanup() {
  await prisma.contact.deleteMany({ where: { lineUserId: { in: [EXISTING, NEWUSER] } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.company } }).catch(() => {});
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (!dbOk) return;
  await cleanup();
  await prisma.company.create({ data: { id: ids.company, name: "Follow Co" } });
  await prisma.contact.create({
    data: { id: ids.contact, companyId: ids.company, firstName: "Known", lastName: "Follower", lineUserId: EXISTING, consentStatus: "OPTED_IN" },
  });
});

afterAll(async () => {
  if (dbOk) await cleanup();
});

describe("processFollowLifecycle", () => {
  it("welcomes a NEW follower with the LIFF link", async (ctx) => {
    if (!dbOk) ctx.skip();
    const reply = vi.fn(okReply);
    const res = await processFollowLifecycle(prisma, body([followEvent(NEWUSER)]), { reply, url: LIFF_URL });
    expect(res).toMatchObject({ welcomed: 1, optedOut: 0 });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(LIFF_URL) }));
  });

  it("does NOT welcome an already-registered contact (no replyToken contention with auto-reply)", async (ctx) => {
    if (!dbOk) ctx.skip();
    const reply = vi.fn(okReply);
    const res = await processFollowLifecycle(prisma, body([followEvent(EXISTING)]), { reply, url: LIFF_URL });
    expect(res.welcomed).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it("does not welcome when no LIFF url is configured", async (ctx) => {
    if (!dbOk) ctx.skip();
    const reply = vi.fn(okReply);
    const res = await processFollowLifecycle(prisma, body([followEvent(NEWUSER)]), { reply, url: null });
    expect(res.welcomed).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it("opts a contact OUT on unfollow (block)", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await processFollowLifecycle(prisma, body([unfollowEvent(EXISTING)]), { url: LIFF_URL });
    expect(res.optedOut).toBe(1);
    const c = await prisma.contact.findUnique({ where: { lineUserId: EXISTING }, select: { consentStatus: true } });
    expect(c?.consentStatus).toBe("OPTED_OUT");
  });

  it("never throws on invalid JSON", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await processFollowLifecycle(prisma, "not json", { url: LIFF_URL });
    expect(res).toEqual({ welcomed: 0, optedOut: 0, failed: 0 });
  });
});
