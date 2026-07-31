import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { aiAutoReplyToWebhook, autoReplyGate, autoReplyProviderMessageId, isAutoReplyMessage } from "./ai-autoreply";
import type { ChatReply, ChatReplyContext } from "@/lib/ai/chat-reply";

describe("autoReplyGate (pure decision matrix)", () => {
  const on = { autoReplyEnabled: true, consentStatus: "OPTED_IN" };

  it("replies to a known, enabled, consenting contact", () => {
    expect(autoReplyGate({ intentHandled: false, contact: on })).toEqual({ ok: true });
  });

  it("stays quiet when a rich-menu intent already answered the message", () => {
    expect(autoReplyGate({ intentHandled: true, contact: on })).toEqual({ ok: false, reason: "intent_handled" });
  });

  it("stays quiet for an unmapped LINE user (no contact → no toggle, no consent state)", () => {
    expect(autoReplyGate({ intentHandled: false, contact: null })).toEqual({ ok: false, reason: "no_contact" });
  });

  it("stays quiet when a sale/admin switched the AI off", () => {
    expect(autoReplyGate({ intentHandled: false, contact: { ...on, autoReplyEnabled: false } })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("stays quiet for an OPTED_OUT customer even with the switch on", () => {
    expect(autoReplyGate({ intentHandled: false, contact: { ...on, consentStatus: "OPTED_OUT" } })).toEqual({
      ok: false,
      reason: "opted_out",
    });
  });

  it("treats UNKNOWN consent as replyable (answering an inbound message is not outreach)", () => {
    expect(autoReplyGate({ intentHandled: false, contact: { ...on, consentStatus: "UNKNOWN" } })).toEqual({ ok: true });
  });
});

describe("autoReplyProviderMessageId / isAutoReplyMessage", () => {
  it("marks AI messages and leaves human ones alone", () => {
    expect(isAutoReplyMessage(autoReplyProviderMessageId("m1"))).toBe(true);
    expect(isAutoReplyMessage("line:12345")).toBe(false);
    expect(isAutoReplyMessage(null)).toBe(false);
  });
});

// DB-backed behaviour. Skipped when Postgres is unreachable, like the other
// integration-style suites in this repo.
const TEST_CO = "ZZ AutoReply Test Co";
const U = (s: string) => `Utest_air_${s}`;

let dbOk = false;
let companyId = "";
let ownerId = "";

const aiReply = (text = "ขอบคุณครับ เดี๋ยวทีมงานติดต่อกลับครับ"): ChatReply => ({ text, source: "ai", model: "injected" });
const okSend = () =>
  vi.fn(async () => ({ ok: true as const, providerMessageId: "line:sent-1", mode: "mock" as const, requestId: null }));

function body(userId: string, text: string, messageId: string) {
  return JSON.stringify({
    events: [
      {
        type: "message",
        webhookEventId: `wh_${messageId}`,
        replyToken: `rt_${messageId}`,
        source: { type: "user", userId },
        message: { type: "text", id: messageId, text },
      },
    ],
  });
}

async function makeContact(lineUserId: string, data: { autoReplyEnabled?: boolean; consentStatus?: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT" } = {}) {
  return prisma.contact.create({
    data: {
      companyId,
      firstName: "ZZA",
      lastName: "Reply",
      lineUserId,
      autoReplyEnabled: data.autoReplyEnabled ?? true,
      consentStatus: data.consentStatus ?? "OPTED_IN",
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (!dbOk) return;
  const co = await prisma.company.create({ data: { name: TEST_CO }, select: { id: true } });
  companyId = co.id;
  const owner = await prisma.user.create({
    data: { name: "AutoReply Owner", email: `air-owner-${Date.now()}@test.local`, role: "MANAGER", passwordHash: "x" },
    select: { id: true },
  });
  ownerId = owner.id;
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.contact.deleteMany({ where: { lineUserId: { startsWith: "Utest_air_" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: "air-owner-" } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { name: TEST_CO } }).catch(() => {});
});

describe("aiAutoReplyToWebhook", () => {
  it("generates, sends, and persists the reply as an audited outbound message", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("happy"));
    const lead = await prisma.lead.create({
      data: { title: "AR lead", companyId, contactId: contact.id, ownerId, source: "LINE_OA", stage: "NEW" },
      select: { id: true },
    });
    const send = okSend();

    const res = await aiAutoReplyToWebhook(prisma, body(U("happy"), "สนใจระบบ CRM ครับ", "m_happy"), {
      generate: async () => aiReply(),
      send,
    });

    expect(res.replied).toBe(1);
    expect(res.leadIds).toEqual([lead.id]);
    expect(send).toHaveBeenCalledTimes(1);

    const msg = await prisma.message.findUnique({ where: { providerMessageId: autoReplyProviderMessageId("m_happy") } });
    expect(msg?.direction).toBe("OUT");
    expect(msg?.status).toBe("SENT");
    expect(msg?.leadId).toBe(lead.id);

    const acts = await prisma.activity.findMany({ where: { leadId: lead.id, type: "LINE_OUT" } });
    expect(acts.some((a) => /AI auto-reply sent/.test(a.body))).toBe(true);
  });

  it("passes the customer's latest message and conversation to the model", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("ctx"));
    await prisma.message.create({
      data: { contactId: contact.id, channel: "LINE", direction: "IN", status: "RECEIVED", body: "ข้อความเก่า" },
    });
    const generate = vi.fn<(c: ChatReplyContext) => Promise<ChatReply>>(async () => aiReply());

    await aiAutoReplyToWebhook(prisma, body(U("ctx"), "ส่งใบเสนอราคาได้ไหมครับ", "m_ctx"), { generate, send: okSend() });

    const passed = generate.mock.calls[0]![0];
    expect(passed.latestInbound).toBe("ส่งใบเสนอราคาได้ไหมครับ");
    expect(passed.companyName).toBe(TEST_CO);
    expect(passed.history.some((m) => m.body === "ข้อความเก่า")).toBe(true);
  });

  it("does not reply twice to a redelivered webhook (idempotency claim)", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(U("dupe"));
    const send = okSend();
    const payload = body(U("dupe"), "สอบถามครับ", "m_dupe");

    const first = await aiAutoReplyToWebhook(prisma, payload, { generate: async () => aiReply(), send });
    const second = await aiAutoReplyToWebhook(prisma, payload, { generate: async () => aiReply(), send });

    expect(first.replied).toBe(1);
    expect(second.replied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the switch is off — the rep owns the conversation", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(U("off"), { autoReplyEnabled: false });
    const send = okSend();
    const generate = vi.fn(async () => aiReply());

    const res = await aiAutoReplyToWebhook(prisma, body(U("off"), "สอบถามครับ", "m_off"), { generate, send });

    expect(res).toMatchObject({ replied: 0, skipped: 1 });
    expect(generate).not.toHaveBeenCalled(); // gated before paying for a model call
    expect(send).not.toHaveBeenCalled();
  });

  it("stays silent for an OPTED_OUT customer", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(U("out"), { consentStatus: "OPTED_OUT" });
    const send = okSend();

    const res = await aiAutoReplyToWebhook(prisma, body(U("out"), "สอบถามครับ", "m_out"), {
      generate: async () => aiReply(),
      send,
    });

    expect(res).toMatchObject({ replied: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a message the rich-menu intent handler already answered", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(U("intent"));
    const send = okSend();

    const res = await aiAutoReplyToWebhook(prisma, body(U("intent"), "ขอติดต่อทีมงาน", "m_intent"), {
      handledMessageIds: ["m_intent"],
      generate: async () => aiReply(),
      send,
    });

    expect(res).toMatchObject({ replied: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores an unmapped LINE user", async (ctx) => {
    if (!dbOk) ctx.skip();
    const send = okSend();
    const res = await aiAutoReplyToWebhook(prisma, body(U("nobody_zzz"), "สวัสดีครับ", "m_nobody"), {
      generate: async () => aiReply(),
      send,
    });
    expect(res).toMatchObject({ replied: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a failed send as a FAILED draft the rep can retry, and never throws", async (ctx) => {
    if (!dbOk) ctx.skip();
    await makeContact(U("failsend"));
    const send = vi.fn(async () => ({
      ok: false as const,
      error: "LINE send failed with HTTP 500",
      retryable: true,
      mode: "line" as const,
      requestId: "req-1",
    }));

    const res = await aiAutoReplyToWebhook(prisma, body(U("failsend"), "สอบถามครับ", "m_fail"), {
      generate: async () => aiReply(),
      send,
    });

    expect(res.failed).toBe(1);
    const msg = await prisma.message.findUnique({ where: { providerMessageId: autoReplyProviderMessageId("m_fail") } });
    expect(msg?.status).toBe("FAILED");
  });

  it("never throws on an invalid payload", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await aiAutoReplyToWebhook(prisma, "not json", { generate: async () => aiReply(), send: okSend() });
    expect(res).toEqual({ replied: 0, skipped: 0, failed: 0, leadIds: [] });
  });
});
