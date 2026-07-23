import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processInboundEmail } from "@/lib/email/inbound";
import { approveAndSendEmailDraft, saveEmailDraft } from "@/lib/email/outbound";
import { approveAndSendLineDraft } from "@/lib/line/outbound";

const ids = {
  user: "test_usr_email",
  company: "test_cmp_email",
  contact: "test_con_email",
  lead: "test_led_email",
  event: "test_email_event_001",
  providerMessage: "test_email_message_001",
};
let dbOk = false;
const originalFromAddress = process.env.EMAIL_FROM_ADDRESS;

async function cleanup() {
  await prisma.webhookEvent.deleteMany({ where: { providerEventId: { in: [ids.event, `email:${ids.event}`] } } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: ids.lead } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.contact } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.company } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {});
}

beforeAll(async () => {
  process.env.EMAIL_FROM_ADDRESS = "sales@jenosize.test";
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    return;
  }
  await cleanup();
  await prisma.user.create({
    data: { id: ids.user, name: "Email Tester", email: "email-tester@test.local", passwordHash: "x", role: "SALES" },
  });
  await prisma.company.create({ data: { id: ids.company, name: "Email Flow Co" } });
  await prisma.contact.create({
    data: {
      id: ids.contact,
      companyId: ids.company,
      firstName: "Email",
      lastName: "Contact",
      email: "customer@test.local",
    },
  });
  await prisma.lead.create({
    data: { id: ids.lead, title: "Email Flow Lead", companyId: ids.company, contactId: ids.contact, ownerId: ids.user },
  });
});

afterAll(async () => {
  if (dbOk) await cleanup();
  if (originalFromAddress === undefined) delete process.env.EMAIL_FROM_ADDRESS;
  else process.env.EMAIL_FROM_ADDRESS = originalFromAddress;
  await prisma.$disconnect();
});

describe("email flow: draft → explicit send, inbound → timeline", () => {
  it("persists a draft, only sends through an injected gateway, and audits the send", async (ctx) => {
    if (!dbOk) ctx.skip();
    const draft = await saveEmailDraft(prisma, {
      leadId: ids.lead,
      userId: ids.user,
      subject: "Proposal for review",
      body: "Please find the proposal attached.",
    });
    expect(draft).toMatchObject({ ok: true, leadId: ids.lead });
    if (!draft.ok) throw new Error("Expected email draft");

    const before = await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } });
    expect(before).toMatchObject({ channel: "EMAIL", direction: "OUT", status: "DRAFT", toAddress: "customer@test.local" });

    await expect(approveAndSendLineDraft(prisma, draft.messageId, ids.user)).resolves.toMatchObject({
      ok: false,
      error: "Message is not a LINE message",
    });

    const sent = await approveAndSendEmailDraft(prisma, draft.messageId, ids.user, async () => ({
      ok: true,
      providerMessageId: "provider-outbound-001",
      requestId: "request-001",
    }));
    expect(sent).toMatchObject({ ok: true, leadId: ids.lead });

    const after = await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } });
    expect(after).toMatchObject({ status: "SENT", providerMessageId: "email:provider-outbound-001" });
    expect(await prisma.activity.count({ where: { leadId: ids.lead, body: "Email sent: Proposal for review" } })).toBe(1);
  });

  it("maps a normalized inbound email once and records a duplicate delivery", async (ctx) => {
    if (!dbOk) ctx.skip();
    const event = {
      providerEventId: ids.event,
      providerMessageId: ids.providerMessage,
      from: "customer@test.local",
      to: "sales@jenosize.demo",
      subject: "Re: Proposal",
      text: "Could we discuss this tomorrow?",
      sentAt: "2026-07-23T09:00:00.000Z",
      threadId: "thread-001",
    };

    await expect(processInboundEmail(prisma, event)).resolves.toEqual({ status: "processed", leadId: ids.lead });
    await expect(processInboundEmail(prisma, event)).resolves.toEqual({ status: "duplicate" });

    expect(await prisma.message.count({ where: { providerMessageId: `email:${ids.providerMessage}`, channel: "EMAIL" } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: ids.lead, body: "Inbound email: Re: Proposal" } })).toBe(1);
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: `email:${ids.event}` } })).toMatchObject({ status: "DUPLICATE" });
  });

  it("atomically claims a draft so concurrent approval attempts call the gateway once", async (ctx) => {
    if (!dbOk) ctx.skip();
    const draft = await saveEmailDraft(prisma, {
      leadId: ids.lead,
      userId: ids.user,
      subject: "Concurrency check",
      body: "Only one request may send this draft.",
    });
    if (!draft.ok) throw new Error("Expected email draft");

    let resolveGateway: () => void;
    const gatewayReady = new Promise<void>((resolve) => { resolveGateway = resolve; });
    let releaseGateway: () => void;
    const holdGateway = new Promise<void>((resolve) => { releaseGateway = resolve; });
    let calls = 0;
    const sender = async () => {
      calls += 1;
      resolveGateway();
      await holdGateway;
      return { ok: true as const, providerMessageId: "provider-outbound-race", requestId: null };
    };

    const first = approveAndSendEmailDraft(prisma, draft.messageId, ids.user, sender);
    await gatewayReady;
    const second = await approveAndSendEmailDraft(prisma, draft.messageId, ids.user, sender);
    releaseGateway!();
    await expect(first).resolves.toMatchObject({ ok: true });

    expect(second).toMatchObject({ ok: false, error: "Email delivery is already in progress" });
    expect(calls).toBe(1);
  });
});
