import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseLineWebhookPayload, parseTextMessageEvent, type LineWebhookPayload } from "./payload";

type Db = PrismaClient;

export type ProcessLineWebhookResult =
  | { status: "processed"; processed: number; duplicates: number; unmapped: number; ignored: number }
  | { status: "duplicate"; processed: 0; duplicates: number; unmapped: number; ignored: number }
  | { status: "invalid"; error: string };

export type ReprocessFailedLineWebhookResult =
  | { ok: true; providerEventId: string; processed: number; duplicates: number; unmapped: number; ignored: number; alreadyProcessed: boolean }
  | { ok: false; error: string };

export function invalidWebhookEventId(rawBody: string, signature: string | null): string {
  const h = createHash("sha256").update(rawBody).update(signature ?? "").digest("hex").slice(0, 48);
  return `invalid:${h}`;
}

export async function recordInvalidLineWebhook(db: Db, rawBody: string, signature: string | null) {
  await db.webhookEvent.upsert({
    where: { providerEventId: invalidWebhookEventId(rawBody, signature) },
    create: {
      provider: "LINE",
      providerEventId: invalidWebhookEventId(rawBody, signature),
      signatureValid: false,
      rawPayload: {
        bodySha256: createHash("sha256").update(rawBody).digest("hex"),
        signaturePresent: signature != null,
      },
      status: "INVALID",
      processedAt: new Date(),
    },
    update: {
      status: "INVALID",
      processedAt: new Date(),
    },
  });
}

export async function processLineWebhook(db: Db, rawBody: string): Promise<ProcessLineWebhookResult> {
  const parsed = parseLineWebhookPayload(rawBody);
  if (!parsed.ok) return { status: "invalid", error: parsed.error };

  let processed = 0;
  let duplicates = 0;
  let unmapped = 0;
  let ignored = 0;

  for (const event of parsed.payload.events) {
    const textEvent = parseTextMessageEvent(event);
    if (!textEvent) {
      ignored += 1;
      continue;
    }

    const result = await processTextMessageEvent(db, parsed.payload, textEvent);
    if (result === "processed") processed += 1;
    if (result === "duplicate") duplicates += 1;
    if (result === "unmapped") unmapped += 1;
  }

  if (processed === 0 && duplicates > 0) return { status: "duplicate", processed, duplicates, unmapped, ignored };
  return { status: "processed", processed, duplicates, unmapped, ignored };
}

// Manual recovery path for a real LINE demo: an inbound webhook may arrive
// before its `source.userId` has been linked to a Contact. The webhook stays as
// a signed FAILED audit row. After the operator maps the Contact.lineUserId,
// this function backfills the CRM Message/Activity from the saved raw payload.
export async function reprocessFailedLineWebhook(
  db: Db,
  providerEventId: string,
): Promise<ReprocessFailedLineWebhookResult> {
  const row = await db.webhookEvent.findUnique({
    where: { providerEventId },
    select: { providerEventId: true, signatureValid: true, rawPayload: true, status: true },
  });

  if (!row) return { ok: false, error: "Webhook event not found" };
  if (!row.signatureValid) return { ok: false, error: "Cannot reprocess an invalid-signature webhook" };
  if (row.status === "PROCESSED" || row.status === "DUPLICATE") {
    return { ok: true, providerEventId, processed: 0, duplicates: 0, unmapped: 0, ignored: 0, alreadyProcessed: true };
  }
  if (row.status !== "FAILED") return { ok: false, error: `Webhook event is ${row.status}, not FAILED` };

  const payload = lineWebhookPayloadFromJson(row.rawPayload);
  if (!payload) return { ok: false, error: "Saved webhook payload is invalid" };

  let processed = 0;
  let duplicates = 0;
  let unmapped = 0;
  let ignored = 0;

  for (const event of payload.events) {
    const textEvent = parseTextMessageEvent(event);
    if (!textEvent) {
      ignored += 1;
      continue;
    }

    const result = await backfillTextMessageEvent(db, textEvent);
    if (result === "processed") processed += 1;
    if (result === "duplicate") duplicates += 1;
    if (result === "unmapped") unmapped += 1;
  }

  if (processed > 0 || (duplicates > 0 && unmapped === 0)) {
    await db.webhookEvent.update({
      where: { providerEventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  }

  return { ok: true, providerEventId, processed, duplicates, unmapped, ignored, alreadyProcessed: false };
}

async function processTextMessageEvent(
  db: Db,
  payload: LineWebhookPayload,
  event: NonNullable<ReturnType<typeof parseTextMessageEvent>>,
): Promise<"processed" | "duplicate" | "unmapped"> {
  const existing = await db.webhookEvent.findUnique({
    where: { providerEventId: event.webhookEventId },
    select: { id: true },
  });
  if (existing) {
    await db.webhookEvent.update({
      where: { providerEventId: event.webhookEventId },
      data: { status: "DUPLICATE", processedAt: new Date() },
    });
    return "duplicate";
  }

  const contact = event.source.userId
    ? await db.contact.findUnique({
        where: { lineUserId: event.source.userId },
        select: {
          id: true,
          leads: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        },
      })
    : null;

  if (!contact) {
    await db.webhookEvent.create({
      data: {
        provider: "LINE",
        providerEventId: event.webhookEventId,
        signatureValid: true,
        rawPayload: toJsonValue(payload),
        status: "FAILED",
        processedAt: new Date(),
      },
    });
    return "unmapped";
  }

  const leadId = contact.leads[0]?.id ?? null;

  await db.$transaction(async (tx) => {
    await tx.webhookEvent.create({
      data: {
        provider: "LINE",
        providerEventId: event.webhookEventId,
        signatureValid: true,
        rawPayload: toJsonValue(payload),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    await tx.message.upsert({
      where: { providerMessageId: event.message.id },
      create: {
        leadId,
        contactId: contact.id,
        channel: "LINE",
        direction: "IN",
        providerMessageId: event.message.id,
        status: "RECEIVED",
        body: event.message.text,
        createdAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      },
      update: {},
    });

    if (leadId) {
      await tx.activity.create({
        data: {
          leadId,
          userId: null,
          type: "LINE_IN",
          body: `Inbound LINE message: ${event.message.text}`,
          metadata: {
            webhookEventId: event.webhookEventId,
            providerMessageId: event.message.id,
            lineUserId: event.source.userId ?? null,
            isRedelivery: event.deliveryContext?.isRedelivery ?? false,
          },
          createdAt: event.timestamp ? new Date(event.timestamp) : new Date(),
        },
      });
    }
  });

  return "processed";
}

async function backfillTextMessageEvent(
  db: Db,
  event: NonNullable<ReturnType<typeof parseTextMessageEvent>>,
): Promise<"processed" | "duplicate" | "unmapped"> {
  const existingMessage = await db.message.findUnique({
    where: { providerMessageId: event.message.id },
    select: { id: true },
  });
  if (existingMessage) return "duplicate";

  const contact = event.source.userId
    ? await db.contact.findUnique({
        where: { lineUserId: event.source.userId },
        select: {
          id: true,
          leads: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        },
      })
    : null;

  if (!contact) return "unmapped";

  const leadId = contact.leads[0]?.id ?? null;

  await db.$transaction(async (tx) => {
    await tx.message.create({
      data: {
        leadId,
        contactId: contact.id,
        channel: "LINE",
        direction: "IN",
        providerMessageId: event.message.id,
        status: "RECEIVED",
        body: event.message.text,
        createdAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      },
    });

    if (leadId) {
      await tx.activity.create({
        data: {
          leadId,
          userId: null,
          type: "LINE_IN",
          body: `Inbound LINE message: ${event.message.text}`,
          metadata: {
            webhookEventId: event.webhookEventId,
            providerMessageId: event.message.id,
            lineUserId: event.source.userId ?? null,
            isRedelivery: event.deliveryContext?.isRedelivery ?? false,
            backfilled: true,
          },
          createdAt: event.timestamp ? new Date(event.timestamp) : new Date(),
        },
      });
    }
  });

  return "processed";
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function lineWebhookPayloadFromJson(value: unknown): LineWebhookPayload | null {
  if (!value || typeof value !== "object") return null;
  const events = (value as { events?: unknown }).events;
  return Array.isArray(events) ? { ...(value as Record<string, unknown>), events } : null;
}
