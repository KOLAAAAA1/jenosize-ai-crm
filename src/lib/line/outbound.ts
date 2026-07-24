import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { copilotResultSchema } from "@/lib/ai/schema";
import { logger } from "@/lib/logger";
import { sendLineTextMessage, type LineSendResult, type SendLineTextInput } from "./adapter";

type SendLineText = (input: SendLineTextInput) => Promise<LineSendResult>;

export type SaveDraftResult = { ok: true; leadId: string; messageId: string } | { ok: false; error: string };
export type SendDraftResult =
  | { ok: true; leadId: string; messageId: string; providerMessageId: string; mode: "mock" | "line"; alreadySent?: boolean }
  | { ok: false; leadId?: string; messageId?: string; error: string; retryable?: boolean };

export async function saveLineDraftFromAiSuggestion(
  db: PrismaClient,
  suggestionId: string,
  userId: string,
): Promise<SaveDraftResult> {
  const suggestion = await db.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      lead: {
        include: {
          contact: true,
        },
      },
    },
  });

  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (suggestion.status !== "SUGGESTED") return { ok: false, error: "Suggestion already reviewed" };

  const parsed = copilotResultSchema.safeParse(suggestion.payload);
  if (!parsed.success) return { ok: false, error: "Suggestion payload is invalid" };

  const draft = parsed.data.lineReply?.draft?.trim();
  if (!draft) return { ok: false, error: "Suggestion has no LINE draft" };
  if (!suggestion.lead.contact.lineUserId) return { ok: false, error: "Contact is not linked to LINE" };
  if (suggestion.lead.contact.consentStatus === "OPTED_OUT") {
    return { ok: false, error: "Contact has opted out of LINE outreach" };
  }

  const messageId = randomUUID();

  await db.$transaction(async (tx) => {
    await tx.message.create({
      data: {
        id: messageId,
        leadId: suggestion.leadId,
        contactId: suggestion.lead.contactId,
        channel: "LINE",
        direction: "OUT",
        status: "DRAFT",
        body: draft,
      },
    });

    await tx.activity.create({
      data: {
        leadId: suggestion.leadId,
        userId,
        type: "LINE_OUT",
        body: "LINE draft saved from AI suggestion.",
        metadata: { suggestionId, messageId },
      },
    });

    await tx.aiSuggestion.update({
      where: { id: suggestionId },
      data: { status: "ACCEPTED" },
    });
  });

  logger.info("line.draft.saved", {
    leadId: suggestion.leadId,
    messageId,
    suggestionId,
    userId,
  });

  return { ok: true, leadId: suggestion.leadId, messageId };
}

// Manual compose: a rep writes a LINE reply directly (no AI). Produces the same
// Message(DRAFT) that approveAndSendLineDraft consumes — so the human-approval
// send path is identical whether the draft came from the copilot or a person.
// This is what makes an outbound send possible when the AI is on the fallback
// (which never produces a LINE draft).
export async function saveLineDraftManual(
  db: PrismaClient,
  leadId: string,
  body: string,
  userId: string,
): Promise<SaveDraftResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Message is empty" };

  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { contact: true } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (!lead.contact.lineUserId) return { ok: false, error: "Contact is not linked to LINE" };
  if (lead.contact.consentStatus === "OPTED_OUT") return { ok: false, error: "Contact has opted out of LINE outreach" };

  const messageId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.message.create({
      data: { id: messageId, leadId: lead.id, contactId: lead.contactId, channel: "LINE", direction: "OUT", status: "DRAFT", body: text },
    });
    await tx.activity.create({
      data: { leadId: lead.id, userId, type: "LINE_OUT", body: "LINE draft composed manually.", metadata: { messageId } },
    });
  });

  logger.info("line.draft.manual", { leadId: lead.id, messageId, userId });
  return { ok: true, leadId: lead.id, messageId };
}

export async function approveAndSendLineDraft(
  db: PrismaClient,
  messageId: string,
  userId: string,
  sendLineText: SendLineText = sendLineTextMessage,
): Promise<SendDraftResult> {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: { contact: true, lead: true },
  });

  if (!message) return { ok: false, error: "Message not found" };
  if (message.channel !== "LINE") return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Message is not a LINE message" };
  if (message.direction !== "OUT") return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Only outbound messages can be sent" };
  if (message.status === "SENT" && message.providerMessageId) {
    return {
      ok: true,
      leadId: message.leadId ?? "",
      messageId,
      providerMessageId: message.providerMessageId,
      mode: "mock",
      alreadySent: true,
    };
  }
  if (message.status !== "DRAFT" && message.status !== "FAILED") {
    return { ok: false, leadId: message.leadId ?? undefined, messageId, error: `Message is ${message.status}, not DRAFT or FAILED` };
  }
  if (!message.contact.lineUserId) return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Contact is not linked to LINE" };
  if (message.contact.consentStatus === "OPTED_OUT") {
    return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Contact has opted out of LINE outreach" };
  }

  await db.message.update({ where: { id: messageId }, data: { status: "APPROVED" } });

  const sent = await sendLineText({
    to: message.contact.lineUserId,
    text: message.body,
    retryKey: retryKeyForMessageId(messageId),
  });

  if (!sent.ok) {
    await db.$transaction(async (tx) => {
      await tx.message.update({ where: { id: messageId }, data: { status: "FAILED" } });
      if (message.leadId) {
        await tx.activity.create({
          data: {
            leadId: message.leadId,
            userId,
            type: "LINE_OUT",
            body: `LINE send failed: ${sent.error}`,
            metadata: { messageId, retryable: sent.retryable, requestId: sent.requestId },
          },
        });
      }
    });
    logger.warn("line.send.failed", {
      leadId: message.leadId,
      messageId,
      retryable: sent.retryable,
      requestId: sent.requestId,
      mode: sent.mode,
      error: sent.error,
    });
    return { ok: false, leadId: message.leadId ?? undefined, messageId, error: sent.error, retryable: sent.retryable };
  }

  await db.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: messageId },
      data: {
        status: "SENT",
        providerMessageId: sent.providerMessageId,
      },
    });

    if (message.leadId) {
      await tx.activity.create({
        data: {
          leadId: message.leadId,
          userId,
          type: "LINE_OUT",
          body: sent.alreadyAccepted ? "LINE message send acknowledged from retry." : "LINE message sent.",
          metadata: {
            messageId,
            providerMessageId: sent.providerMessageId,
            mode: sent.mode,
            requestId: sent.requestId,
            alreadyAccepted: sent.alreadyAccepted ?? false,
          },
        },
      });
    }
  });

  logger.info("line.send.succeeded", {
    leadId: message.leadId,
    messageId,
    providerMessageId: sent.providerMessageId,
    mode: sent.mode,
    requestId: sent.requestId,
    alreadyAccepted: sent.alreadyAccepted ?? false,
  });

  return {
    ok: true,
    leadId: message.leadId ?? "",
    messageId,
    providerMessageId: sent.providerMessageId,
    mode: sent.mode,
  };
}

export function retryKeyForMessageId(messageId: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    return messageId;
  }

  const h = createHash("sha256").update(messageId).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
