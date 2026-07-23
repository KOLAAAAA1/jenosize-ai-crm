import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

export type InboundEmail = {
  providerEventId: string;
  providerMessageId?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  sentAt?: string;
  threadId?: string;
};

export const inboundEmailSchema = z.object({
  providerEventId: z.string().trim().min(1).max(500),
  providerMessageId: z.string().trim().min(1).max(500).optional(),
  from: z.string().trim().toLowerCase().email(),
  to: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(1).max(998),
  text: z.string().min(1).max(100_000),
  sentAt: z.string().datetime().optional(),
  threadId: z.string().trim().min(1).max(500).optional(),
});

export type ProcessInboundEmailResult =
  | { status: "processed"; leadId: string | null }
  | { status: "duplicate" }
  | { status: "unmapped" };

// Converts a provider-normalized inbound email into the existing immutable
// Message + Activity timeline. The providerEventId is the delivery dedupe key;
// providerMessageId independently guards against a gateway that retries under a
// new event envelope.
export async function processInboundEmail(
  db: PrismaClient,
  email: InboundEmail,
): Promise<ProcessInboundEmailResult> {
  const providerEventId = emailProviderEventKey(email.providerEventId);
  const providerMessageId = emailProviderMessageKey(email.providerMessageId || email.providerEventId);
  const existingEvent = await db.webhookEvent.findUnique({
    where: { providerEventId },
    select: { id: true },
  });
  if (existingEvent) {
    await db.webhookEvent.update({
      where: { providerEventId },
      data: { status: "DUPLICATE", processedAt: new Date() },
    });
    return { status: "duplicate" };
  }

  const contact = await db.contact.findFirst({
    where: { email: { equals: email.from, mode: "insensitive" } },
    select: {
      id: true,
      leads: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  if (!contact) {
    await db.webhookEvent.create({
      data: {
        provider: "EMAIL",
        providerEventId,
        signatureValid: true,
        rawPayload: toJsonValue(email),
        status: "FAILED",
        processedAt: new Date(),
      },
    });
    return { status: "unmapped" };
  }

  const leadId = contact.leads[0]?.id ?? null;
  const existingMessage = await db.message.findUnique({ where: { providerMessageId }, select: { id: true } });
  if (existingMessage) {
    await db.webhookEvent.create({
      data: {
        provider: "EMAIL",
        providerEventId,
        signatureValid: true,
        rawPayload: toJsonValue(email),
        status: "DUPLICATE",
        processedAt: new Date(),
      },
    });
    return { status: "duplicate" };
  }

  const createdAt = email.sentAt && !Number.isNaN(Date.parse(email.sentAt)) ? new Date(email.sentAt) : new Date();
  await db.$transaction(async (tx) => {
    await tx.webhookEvent.create({
      data: {
        provider: "EMAIL",
        providerEventId,
        signatureValid: true,
        rawPayload: toJsonValue(email),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });
    await tx.message.create({
      data: {
        leadId,
        contactId: contact.id,
        channel: "EMAIL",
        direction: "IN",
        providerMessageId,
        providerThreadId: email.threadId ?? null,
        status: "RECEIVED",
        subject: email.subject,
        body: email.text,
        fromAddress: email.from,
        toAddress: email.to,
        createdAt,
      },
    });
    if (leadId) {
      await tx.activity.create({
        data: {
          leadId,
          userId: null,
          type: "EMAIL",
          body: `Inbound email: ${email.subject}`,
          metadata: { providerEventId, providerMessageId, from: email.from },
          createdAt,
        },
      });
    }
  });

  return { status: "processed", leadId };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function emailProviderEventKey(providerEventId: string): string {
  return `email:${providerEventId}`;
}

function emailProviderMessageKey(providerMessageId: string): string {
  return `email:${providerMessageId}`;
}
