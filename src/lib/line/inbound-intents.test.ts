import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { classifyIntent, handleInboundIntents, CONTACT_TEAM_KEYWORD, INQUIRY_KEYWORD } from "./inbound-intents";

const TEST_CO = "ZZ Intent Test Co";
const U = (s: string) => `Utest_intent_${s}`;

let dbOk = false;
let companyId = "";
let ownerId = "";

const okReply = () => vi.fn(async () => ({ ok: true as const, providerMessageId: "m", mode: "mock" as const, requestId: null }));
const resolveOwner = async () => ownerId;

function body(userId: string, text: string, opts: { isRedelivery?: boolean } = {}) {
  const rnd = () => Math.random().toString(36).slice(2);
  return JSON.stringify({
    events: [
      {
        type: "message",
        webhookEventId: `wh_${rnd()}`,
        replyToken: `rt_${rnd()}`,
        source: { type: "user", userId },
        message: { type: "text", id: `m_${rnd()}`, text },
        deliveryContext: { isRedelivery: opts.isRedelivery ?? false },
      },
    ],
  });
}

async function makeContact(lineUserId: string, pendingIntent: "AWAITING_INQUIRY" | null = null) {
  return prisma.contact.create({ data: { companyId, firstName: "ZZI", lastName: "x", lineUserId, pendingIntent }, select: { id: true } });
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
  const owner = await prisma.user.create({ data: { name: "Intent Owner", email: `intent-owner-${Date.now()}@test.local`, role: "MANAGER", passwordHash: "x" }, select: { id: true } });
  ownerId = owner.id;
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.contact.deleteMany({ where: { lineUserId: { startsWith: "Utest_intent_" } } }).catch(() => {}); // cascades their leads/activities
  await prisma.user.deleteMany({ where: { email: { startsWith: "intent-owner-" } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { name: TEST_CO } }).catch(() => {});
});

describe("classifyIntent (pure)", () => {
  it("maps the two keywords, the awaiting-capture state, and none", () => {
    expect(classifyIntent(CONTACT_TEAM_KEYWORD, null).kind).toBe("contact_team");
    expect(classifyIntent(INQUIRY_KEYWORD, null).kind).toBe("inquiry_start");
    expect(classifyIntent("อยากได้ CRM ครับ งบ 5 แสน", "AWAITING_INQUIRY").kind).toBe("inquiry_capture");
    expect(classifyIntent("อยากได้ CRM ครับ", null).kind).toBe("none");
    // a keyword still wins even while awaiting
    expect(classifyIntent(INQUIRY_KEYWORD, "AWAITING_INQUIRY").kind).toBe("inquiry_start");
  });
});

describe("handleInboundIntents", () => {
  it("A · acknowledges 'ขอติดต่อทีมงาน' and logs an Activity on the contact's lead", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("team"));
    const lead = await prisma.lead.create({ data: { title: "existing", companyId, contactId: contact.id, ownerId, source: "LINE_OA", stage: "NEW" }, select: { id: true } });
    const reply = okReply();

    const payload = body(U("team"), CONTACT_TEAM_KEYWORD);
    const r = await handleInboundIntents(prisma, payload, { reply, resolveOwnerId: resolveOwner });
    expect(r.replied).toBe(1);
    // The message is claimed, so the AI auto-reply that runs next stays quiet
    // instead of answering on top of the canned acknowledgement.
    expect(r.handledMessageIds).toEqual([JSON.parse(payload).events[0].message.id]);
    expect((reply.mock.calls[0] as unknown as [{ text: string }])[0].text).toMatch(/รับเรื่องแล้ว/);
    const acts = await prisma.activity.findMany({ where: { leadId: lead.id, type: "NOTE" } });
    expect(acts.some((a) => /ติดต่อกลับ/.test(a.body))).toBe(true);
  });

  it("B1 · sets pendingIntent on 'ขอสอบถามข้อมูลเพิ่มเติม' and asks for details", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("start"));
    const reply = okReply();

    const r = await handleInboundIntents(prisma, body(U("start"), INQUIRY_KEYWORD), { reply, resolveOwnerId: resolveOwner });
    expect(r.replied).toBe(1);
    expect((reply.mock.calls[0] as unknown as [{ text: string }])[0].text).toMatch(/งบประมาณ/);
    const row = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(row?.pendingIntent).toBe("AWAITING_INQUIRY");
  });

  it("B2 · captures the next message into a NEW lead, clears pendingIntent, and is idempotent", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("capture"), "AWAITING_INQUIRY");
    const reply = okReply();

    const r1 = await handleInboundIntents(prisma, body(U("capture"), "อยากได้ระบบ CRM งบ 500k ครับ"), { reply, resolveOwnerId: resolveOwner });
    expect(r1.leadsCreated).toBe(1);
    expect(r1.replied).toBe(1);

    const leads = await prisma.lead.findMany({ where: { contactId: contact.id }, include: { activities: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0].source).toBe("LINE_OA");
    expect(leads[0].stage).toBe("NEW");
    expect(leads[0].ownerId).toBe(ownerId);
    expect(leads[0].activities.some((a) => /500k/.test(a.body))).toBe(true);
    expect((await prisma.contact.findUnique({ where: { id: contact.id } }))?.pendingIntent).toBeNull();

    // A duplicate/redelivered capture must NOT create a second lead (pendingIntent already cleared).
    const r2 = await handleInboundIntents(prisma, body(U("capture"), "ส่งซ้ำ"), { reply: okReply(), resolveOwnerId: resolveOwner });
    expect(r2.leadsCreated).toBe(0);
    expect(await prisma.lead.count({ where: { contactId: contact.id } })).toBe(1);
  });

  it("leaves pendingIntent set (no lead lost) when no default owner resolves", async (ctx) => {
    if (!dbOk) ctx.skip();
    const contact = await makeContact(U("noowner"), "AWAITING_INQUIRY");
    const reply = okReply();

    const r = await handleInboundIntents(prisma, body(U("noowner"), "รายละเอียด"), { reply, resolveOwnerId: async () => null });
    expect(r.leadsCreated).toBe(0);
    expect(reply).not.toHaveBeenCalled();
    expect((await prisma.contact.findUnique({ where: { id: contact.id } }))?.pendingIntent).toBe("AWAITING_INQUIRY");
  });

  it("ignores an unmapped LINE user", async (ctx) => {
    if (!dbOk) ctx.skip();
    const reply = okReply();
    const r = await handleInboundIntents(prisma, body(U("unknown_zzz"), CONTACT_TEAM_KEYWORD), { reply, resolveOwnerId: resolveOwner });
    // Unhandled: an unmapped user is nobody's message — the AI auto-reply skips it
    // for the same reason (no Contact → no toggle, no consent state).
    expect(r).toEqual({ replied: 0, leadsCreated: 0, handledMessageIds: [] });
    expect(reply).not.toHaveBeenCalled();
  });
});
