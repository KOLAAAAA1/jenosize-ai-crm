import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyStageMove } from "@/lib/leads-service";
import { generateSuggestion, type CallModel } from "@/lib/ai/copilot";
import type { CopilotContext } from "@/lib/ai/context";
import { copilotResultSchema } from "@/lib/ai/schema";
import { POST as lineWebhookPost } from "@/app/api/line/webhook/route";
import { computeLineSignature } from "@/lib/line/signature";
import { invalidWebhookEventId, reprocessFailedLineWebhook } from "@/lib/line/service";
import { approveAndSendLineDraft, saveLineDraftFromAiSuggestion, saveLineDraftManual } from "@/lib/line/outbound";

// Part 3 required test #1: core CRM flow — create lead → move stage → activity logged.
// Integration test against the local Postgres (run `pnpm db:up` first).
// Skips gracefully if the database is unreachable so unit tests still pass.

const ids = {
  user: "test_usr_flow",
  company: "test_cmp_flow",
  contact: "test_con_flow",
  lead: "test_led_flow",
  lineCompany: "test_cmp_line",
  lineContact: "test_con_line",
  lineLead: "test_led_line",
  backfillContact: "test_con_line_backfill",
  backfillLead: "test_led_line_backfill",
  lineSuggestion: "test_sug_line",
};
let dbOk = false;
const lineSecret = "test-line-channel-secret";
const lineUserId = "Utestlineuser000000000000000000000001";
const backfillLineUserId = "Utestlineuser000000000000000000000002";
const lineEventId = "test_webhook_event_001";
const lineMessageId = "test_line_message_001";
const backfillEventId = "test_webhook_backfill_001";
const backfillMessageId = "test_line_backfill_001";
const lineBody = JSON.stringify({
  destination: "Ubotdestination",
  events: [
    {
      type: "message",
      webhookEventId: lineEventId,
      deliveryContext: { isRedelivery: false },
      timestamp: Date.parse("2026-07-20T08:00:00.000Z"),
      source: { type: "user", userId: lineUserId },
      replyToken: "test_reply_token",
      mode: "active",
      message: { type: "text", id: lineMessageId, text: "Please send the proposal by Friday." },
    },
  ],
});
const invalidLineBody = JSON.stringify({
  destination: "Ubotdestination",
  events: [
    {
      type: "message",
      webhookEventId: "test_webhook_invalid_001",
      timestamp: Date.parse("2026-07-20T08:05:00.000Z"),
      source: { type: "user", userId: lineUserId },
      message: { type: "text", id: "test_line_invalid_001", text: "This should not be processed." },
    },
  ],
});
const backfillLineBody = JSON.stringify({
  destination: "Ubotdestination",
  events: [
    {
      type: "message",
      webhookEventId: backfillEventId,
      deliveryContext: { isRedelivery: false },
      timestamp: Date.parse("2026-07-20T08:15:00.000Z"),
      source: { type: "user", userId: backfillLineUserId },
      message: { type: "text", id: backfillMessageId, text: "This arrived before mapping." },
    },
  ],
});

async function cleanup() {
  // deleting the lead cascades its activities/messages
  await prisma.lead.deleteMany({ where: { id: ids.lead } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: ids.lineLead } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: ids.backfillLead } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.contact } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.lineContact } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { id: ids.backfillContact } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.company } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: ids.lineCompany } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {});
  await prisma.webhookEvent.deleteMany({
    where: {
      providerEventId: {
        in: [lineEventId, backfillEventId, invalidWebhookEventId(invalidLineBody, "bad-signature")],
      },
    },
  }).catch(() => {});
  await prisma.message.deleteMany({
    where: { providerMessageId: { in: [lineMessageId, backfillMessageId, "test_line_invalid_001"] } },
  }).catch(() => {});
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  await cleanup();
  await prisma.user.create({
    data: { id: ids.user, name: "Flow Tester", email: `flow-${Date.now()}@test.local`, passwordHash: "x", role: "SALES" },
  });
  await prisma.company.create({ data: { id: ids.company, name: "Flow Co" } });
  await prisma.contact.create({ data: { id: ids.contact, companyId: ids.company, firstName: "Flow", lastName: "Contact" } });
  await prisma.lead.create({
    data: { id: ids.lead, title: "Flow Lead", companyId: ids.company, contactId: ids.contact, ownerId: ids.user, stage: "NEW", source: "MANUAL" },
  });

  await prisma.company.create({ data: { id: ids.lineCompany, name: "LINE Flow Co" } });
  await prisma.contact.create({
    data: { id: ids.lineContact, companyId: ids.lineCompany, firstName: "LINE", lastName: "Contact", lineUserId, consentStatus: "OPTED_IN" },
  });
  await prisma.contact.create({
    data: { id: ids.backfillContact, companyId: ids.lineCompany, firstName: "Backfill", lastName: "Contact", consentStatus: "OPTED_IN" },
  });
  await prisma.lead.create({
    data: {
      id: ids.lineLead,
      title: "LINE Flow Lead",
      companyId: ids.lineCompany,
      contactId: ids.lineContact,
      ownerId: ids.user,
      stage: "QUALIFIED",
      source: "LINE_OA",
    },
  });
  await prisma.lead.create({
    data: {
      id: ids.backfillLead,
      title: "Backfill LINE Lead",
      companyId: ids.lineCompany,
      contactId: ids.backfillContact,
      ownerId: ids.user,
      stage: "NEW",
      source: "LINE_OA",
    },
  });
});

afterAll(async () => {
  if (dbOk) await cleanup();
  await prisma.$disconnect();
});

describe("CRM flow: create lead → move stage → activity logged", () => {
  it("moves the stage and appends a STAGE_CHANGE activity", async (ctx) => {
    if (!dbOk) ctx.skip();
    const before = await prisma.activity.count({ where: { leadId: ids.lead, type: "STAGE_CHANGE" } });

    const res = await applyStageMove(prisma, { leadId: ids.lead, userId: ids.user, nextStage: "QUALIFIED" });
    expect(res).toEqual({ ok: true, changed: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } });
    expect(lead.stage).toBe("QUALIFIED");

    const after = await prisma.activity.count({ where: { leadId: ids.lead, type: "STAGE_CHANGE" } });
    expect(after).toBe(before + 1);

    const activity = await prisma.activity.findFirstOrThrow({
      where: { leadId: ids.lead, type: "STAGE_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity.metadata).toMatchObject({ from: "NEW", to: "QUALIFIED" });
  });

  it("is a no-op when moving to the current stage", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await applyStageMove(prisma, { leadId: ids.lead, userId: ids.user, nextStage: "QUALIFIED" });
    expect(res).toEqual({ ok: true, changed: false });
  });

  it("returns an error for an unknown lead", async (ctx) => {
    if (!dbOk) ctx.skip();
    const res = await applyStageMove(prisma, { leadId: "does-not-exist", userId: ids.user, nextStage: "WON" });
    expect(res).toEqual({ ok: false, error: "Lead not found" });
  });
});

// Part-3 required test #2 — AI skill fallback. No DB needed: the model call is
// an injected dependency, so a throwing callModel exercises the exact path a
// missing key or a downed model service takes in production.
describe("Part 3 — AI skill fallback (model unavailable)", () => {
  const ctx: CopilotContext = {
    leadId: "led_flow_ai",
    title: "Fallback Lead",
    stage: "QUALIFIED",
    source: "WEBSITE",
    valueTHB: 750_000,
    score: null,
    company: { name: "Flow Co", industry: "Finance", size: "51-200" },
    contact: { name: "Ratana", title: "Head of Ops", consentStatus: "UNKNOWN", hasLine: false },
    ownerName: "Flow Tester",
    activities: [],
    messages: [],
    daysSinceLastActivity: 12,
    now: "2026-07-20T00:00:00.000Z",
  };

  it("mock LLM throws → deterministic result returned & schema-valid", async () => {
    const throwing: CallModel = async () => {
      throw new Error("model service unavailable");
    };
    const s = await generateSuggestion(ctx, { callModel: throwing });

    expect(s.source).toBe("fallback");
    expect(s.model).toBe("deterministic");
    expect(copilotResultSchema.safeParse(s).success).toBe(true);
    expect(s.status).toBe("service_unavailable");
    expect(s.qualification.score).toBeTypeOf("number");
    expect(s.lineReply).toBeNull();
  });
});

// Part-3 required test #3 — LINE webhook security/idempotency.
describe("Part 3 — LINE webhook security/idempotency", () => {
  it("invalid X-Line-Signature → 401, body not processed", async (ctx) => {
    if (!dbOk) ctx.skip();
    process.env.LINE_CHANNEL_SECRET = lineSecret;

    const res = await lineWebhookPost(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": "bad-signature" },
        body: invalidLineBody,
      }),
    );

    expect(res.status).toBe(401);
    expect(await prisma.message.count({ where: { providerMessageId: "test_line_invalid_001" } })).toBe(0);
    expect(await prisma.activity.count({ where: { leadId: ids.lineLead, body: { contains: "This should not be processed" } } })).toBe(0);
    expect(
      await prisma.webhookEvent.count({
        where: { providerEventId: invalidWebhookEventId(invalidLineBody, "bad-signature"), signatureValid: false, status: "INVALID" },
      }),
    ).toBe(1);
  });

  it("duplicate providerEventId → processed once (idempotent)", async (ctx) => {
    if (!dbOk) ctx.skip();
    process.env.LINE_CHANNEL_SECRET = lineSecret;
    const signature = computeLineSignature(lineBody, lineSecret);

    const first = await lineWebhookPost(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": signature },
        body: lineBody,
      }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "processed", processed: 1, duplicates: 0 });

    const second = await lineWebhookPost(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": signature },
        body: lineBody,
      }),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "duplicate", processed: 0, duplicates: 1 });

    expect(await prisma.webhookEvent.count({ where: { providerEventId: lineEventId } })).toBe(1);
    expect(await prisma.message.count({ where: { providerMessageId: lineMessageId } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: ids.lineLead, type: "LINE_IN", body: { contains: "Please send the proposal" } } })).toBe(1);
  });

  it("AI LINE draft → human approval → mock send is audited", async (ctx) => {
    if (!dbOk) ctx.skip();

    await prisma.aiSuggestion.create({
      data: {
        id: ids.lineSuggestion,
        leadId: ids.lineLead,
        type: "SUMMARY",
        model: "test-model",
        createdBy: "ai:test-model",
        status: "SUGGESTED",
        payload: {
          status: "success",
          summary: { overview: "Customer asked for a proposal.", keyFacts: ["Recent LINE request"], openQuestions: [] },
          qualification: { score: 80, confidence: "high", reasons: ["Requested proposal"], recommendedStage: "no_change" },
          nextAction: { action: "Send proposal", reason: "Customer requested it", priority: "high" },
          lineReply: { draft: "Thanks, we will send the proposal by Friday.", requiresApproval: true },
          warnings: [],
          source: "ai",
          model: "test-model",
          generatedAt: "2026-07-20T08:10:00.000Z",
        },
      },
    });

    const draft = await saveLineDraftFromAiSuggestion(prisma, ids.lineSuggestion, ids.user);
    expect(draft).toMatchObject({ ok: true, leadId: ids.lineLead });
    if (!draft.ok) throw new Error("expected draft save to succeed");

    const message = await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } });
    expect(message.status).toBe("DRAFT");
    expect(message.direction).toBe("OUT");
    expect(message.providerMessageId).toBeNull();

    const sent = await approveAndSendLineDraft(prisma, draft.messageId, ids.user, async (input) => ({
      ok: true,
      providerMessageId: `mock-provider:${input.retryKey}`,
      mode: "mock",
      requestId: null,
    }));

    expect(sent).toMatchObject({ ok: true, leadId: ids.lineLead, messageId: draft.messageId, mode: "mock" });

    const sentMessage = await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } });
    expect(sentMessage.status).toBe("SENT");
    expect(sentMessage.providerMessageId).toMatch(/^mock-provider:/);
    expect(await prisma.activity.count({ where: { leadId: ids.lineLead, type: "LINE_OUT", body: "LINE message sent." } })).toBe(1);
  });

  it("backfills a signed unmapped LINE event after the contact is mapped", async (ctx) => {
    if (!dbOk) ctx.skip();
    process.env.LINE_CHANNEL_SECRET = lineSecret;
    const signature = computeLineSignature(backfillLineBody, lineSecret);

    const first = await lineWebhookPost(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": signature },
        body: backfillLineBody,
      }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "processed", processed: 0, unmapped: 1 });
    expect(await prisma.message.count({ where: { providerMessageId: backfillMessageId } })).toBe(0);

    const failed = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: backfillEventId } });
    expect(failed.status).toBe("FAILED");
    expect(failed.signatureValid).toBe(true);

    await prisma.contact.update({ where: { id: ids.backfillContact }, data: { lineUserId: backfillLineUserId } });

    const res = await reprocessFailedLineWebhook(prisma, backfillEventId);
    expect(res).toMatchObject({ ok: true, processed: 1, unmapped: 0, alreadyProcessed: false });

    const message = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: backfillMessageId } });
    expect(message.contactId).toBe(ids.backfillContact);
    expect(message.leadId).toBe(ids.backfillLead);
    expect(message.status).toBe("RECEIVED");
    expect(await prisma.activity.count({ where: { leadId: ids.backfillLead, type: "LINE_IN", body: { contains: "This arrived before mapping" } } })).toBe(1);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: backfillEventId } })).status).toBe("PROCESSED");

    const again = await reprocessFailedLineWebhook(prisma, backfillEventId);
    expect(again).toMatchObject({ ok: true, alreadyProcessed: true });
    expect(await prisma.message.count({ where: { providerMessageId: backfillMessageId } })).toBe(1);
  });
});

describe("Block 9 — manual LINE draft compose → send", () => {
  it("saves a rep-composed draft, then sends it through the approve path", async (ctx) => {
    if (!dbOk) ctx.skip();
    const draft = await saveLineDraftManual(prisma, ids.lineLead, "สวัสดีครับ ทดสอบส่งจริง", ids.user);
    expect(draft).toMatchObject({ ok: true, leadId: ids.lineLead });
    if (!draft.ok) throw new Error("expected manual draft to save");

    const message = await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } });
    expect(message.status).toBe("DRAFT");
    expect(message.direction).toBe("OUT");
    expect(message.body).toBe("สวัสดีครับ ทดสอบส่งจริง");

    const sent = await approveAndSendLineDraft(prisma, draft.messageId, ids.user, async (input) => ({
      ok: true,
      providerMessageId: `mock:${input.retryKey}`,
      mode: "mock",
      requestId: null,
    }));
    expect(sent).toMatchObject({ ok: true, mode: "mock" });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: draft.messageId } })).status).toBe("SENT");
  });

  it("refuses to draft when the contact is not linked to LINE, or the body is empty", async (ctx) => {
    if (!dbOk) ctx.skip();
    expect(await saveLineDraftManual(prisma, ids.lead, "hi", ids.user)).toEqual({ ok: false, error: "Contact is not linked to LINE" });
    expect(await saveLineDraftManual(prisma, ids.lineLead, "   ", ids.user)).toEqual({ ok: false, error: "Message is empty" });
  });
});
