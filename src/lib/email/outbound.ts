import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { sendEmailMessage, type EmailSendResult, type SendEmailInput } from "./adapter";

type SendEmail = (input: SendEmailInput) => Promise<EmailSendResult>;

export type SaveEmailDraftResult =
  | { ok: true; leadId: string; messageId: string }
  | { ok: false; error: string };

export type SendEmailDraftResult =
  | { ok: true; leadId: string; messageId: string; providerMessageId: string; alreadySent?: boolean }
  | { ok: false; leadId?: string; messageId?: string; error: string; retryable?: boolean };

export async function saveEmailDraft(
  db: PrismaClient,
  input: { leadId: string; userId: string; subject: string; body: string },
): Promise<SaveEmailDraftResult> {
  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    include: { contact: { select: { id: true, email: true } }, owner: { select: { name: true } } },
  });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (!lead.contact.email) return { ok: false, error: "Contact has no email address" };

  const messageId = randomUUID();
  const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim() || null;

  await db.$transaction([
    db.message.create({
      data: {
        id: messageId,
        leadId: lead.id,
        contactId: lead.contact.id,
        channel: "EMAIL",
        direction: "OUT",
        status: "DRAFT",
        subject: input.subject,
        body: input.body,
        fromAddress,
        toAddress: lead.contact.email,
      },
    }),
    db.activity.create({
      data: {
        leadId: lead.id,
        userId: input.userId,
        type: "EMAIL",
        body: `Email draft saved: ${input.subject}`,
        metadata: { messageId, direction: "OUT", status: "DRAFT" },
      },
    }),
  ]);

  logger.info("email.draft.saved", { leadId: lead.id, messageId, userId: input.userId });
  return { ok: true, leadId: lead.id, messageId };
}

export async function approveAndSendEmailDraft(
  db: PrismaClient,
  messageId: string,
  userId: string,
  sendEmail: SendEmail = sendEmailMessage,
): Promise<SendEmailDraftResult> {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: { contact: { select: { email: true } }, lead: { select: { id: true } } },
  });

  if (!message) return { ok: false, error: "Message not found" };
  if (message.channel !== "EMAIL") return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Message is not an email" };
  if (message.direction !== "OUT") return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Only outbound email can be sent" };
  if (message.status === "SENT" && message.providerMessageId) {
    return { ok: true, leadId: message.leadId ?? "", messageId, providerMessageId: message.providerMessageId, alreadySent: true };
  }
  const to = message.toAddress ?? message.contact.email;
  const from = message.fromAddress ?? process.env.EMAIL_FROM_ADDRESS?.trim();
  if (!to) return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Contact has no email address" };
  if (!from) return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "EMAIL_FROM_ADDRESS is not configured" };
  if (!message.subject) return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Email subject is missing" };

  // Claim this draft atomically before the external side effect. Server Actions
  // are sequential only per browser client; two tabs (or two users) can still
  // race, so a prior read of DRAFT is not sufficient protection.
  const claim = await db.message.updateMany({
    where: { id: messageId, status: { in: ["DRAFT", "FAILED"] } },
    data: { status: "APPROVED", fromAddress: from, toAddress: to },
  });
  if (claim.count === 0) {
    const current = await db.message.findUnique({ where: { id: messageId }, select: { status: true, providerMessageId: true } });
    if (current?.status === "SENT" && current.providerMessageId) {
      return { ok: true, leadId: message.leadId ?? "", messageId, providerMessageId: current.providerMessageId, alreadySent: true };
    }
    return { ok: false, leadId: message.leadId ?? undefined, messageId, error: "Email delivery is already in progress", retryable: true };
  }

  const sent = await sendEmail({
    from,
    to,
    subject: message.subject,
    text: message.body,
    idempotencyKey: messageId,
  });

  if (!sent.ok) {
    await db.$transaction(async (tx) => {
      await tx.message.update({ where: { id: messageId }, data: { status: "FAILED" } });
      if (message.leadId) {
        await tx.activity.create({
          data: {
            leadId: message.leadId,
            userId,
            type: "EMAIL",
            body: `Email send failed: ${sent.error}`,
            metadata: { messageId, retryable: sent.retryable, requestId: sent.requestId },
          },
        });
      }
    });
    logger.warn("email.send.failed", {
      leadId: message.leadId,
      messageId,
      retryable: sent.retryable,
      requestId: sent.requestId,
      error: sent.error,
    });
    return { ok: false, leadId: message.leadId ?? undefined, messageId, error: sent.error, retryable: sent.retryable };
  }

  await db.$transaction(async (tx) => {
    const providerMessageId = emailProviderMessageKey(sent.providerMessageId);
    await tx.message.update({
      where: { id: messageId },
      data: { status: "SENT", providerMessageId },
    });
    if (message.leadId) {
      await tx.activity.create({
        data: {
          leadId: message.leadId,
          userId,
          type: "EMAIL",
          body: `Email sent: ${message.subject}`,
          metadata: { messageId, providerMessageId, requestId: sent.requestId },
        },
      });
    }
  });

  logger.info("email.send.succeeded", {
    leadId: message.leadId,
    messageId,
    providerMessageId: emailProviderMessageKey(sent.providerMessageId),
    requestId: sent.requestId,
  });
  return { ok: true, leadId: message.leadId ?? "", messageId, providerMessageId: emailProviderMessageKey(sent.providerMessageId) };
}

// `Message.providerMessageId` is unique across LINE and email, so preserve the
// provider's value while namespacing it by channel to avoid cross-provider
// collisions (for example, both providers emitting a bare numeric ID).
function emailProviderMessageKey(providerMessageId: string): string {
  return `email:${providerMessageId}`;
}
