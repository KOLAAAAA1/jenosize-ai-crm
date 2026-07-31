// AI auto-reply for the LINE OA — the default behaviour for an inbound customer
// message (PLAN §5, SKILL.md §"Auto-reply mode").
//
// Replaces the earlier canned-greeting auto-reply. What changed, and why it matters:
//
//   before: fixed string, only for contacts explicitly toggled ON (default off),
//           no Message/Activity rows, no consent check.
//   now:    model-generated reply, ON by default (`Contact.autoReplyEnabled`),
//           persisted as Message(OUT) + Activity(LINE_OUT) so it shows in the chat
//           box and the audit timeline, and skipped for OPTED_OUT contacts.
//
// A sale/admin turns the switch OFF to take over the conversation by hand from the
// lead's chat box; the human path (outbound.ts) keeps its approve-then-send boundary.
//
// Design notes:
//   - PUSH, not the reply token. The model call takes seconds and a replyToken is
//     single-use and expires in ~1 minute — and the OA console's own greeting may
//     have consumed it already (see adapter.ts).
//   - Idempotency: the outbound Message claims `providerMessageId =
//     "line-ai:<inbound message id>"`, whose UNIQUE index makes a webhook
//     redelivery lose the race and skip instead of double-messaging the customer.
//     The real provider id goes in the Activity metadata. (A human "Retry send" on a
//     FAILED row overwrites the synthetic key with the real one — acceptable: by
//     then a person has taken responsibility for the send.)
//   - Best-effort: never throws. Called after ingestion in the webhook route, so a
//     failure here must not turn the 200 into a 500 and make LINE retry everything.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { generateChatReply, type ChatReply, type ChatReplyContext } from "@/lib/ai/chat-reply";
import { logger } from "@/lib/logger";
import { sendLineTextMessage, type LineSendResult, type SendLineTextInput } from "./adapter";
import { parseLineWebhookPayload, parseTextMessageEvent } from "./payload";
import { retryKeyForMessageId } from "./outbound";

type Db = PrismaClient;
type SendLineText = (input: SendLineTextInput) => Promise<LineSendResult>;
type GenerateFn = (ctx: ChatReplyContext) => Promise<ChatReply>;

// How much conversation the model sees. Enough for continuity, small enough to keep
// the prompt (and the webhook's open request) short.
const HISTORY_LIMIT = 10;

export type AutoReplyOutcome = {
  replied: number;
  skipped: number;
  failed: number;
  // Leads whose conversation gained a message — the route revalidates their pages.
  leadIds: string[];
};

export type SkipReason =
  | "intent_handled" // a rich-menu intent already answered this exact message
  | "no_contact" // unmapped LINE user: no Contact, so no toggle and no consent state
  | "disabled" // sale/admin switched AI auto-reply off for this customer
  | "opted_out" // SKILL.md: never contact an OPTED_OUT customer
  | "already_replied"; // redelivery / duplicate — the idempotency claim held

export type GateInput = {
  intentHandled: boolean;
  contact: { autoReplyEnabled: boolean; consentStatus: string } | null;
};

// Pure: the decision to reply, split out so the whole matrix is unit-testable
// without a database. `already_replied` is not decidable here — it is the outcome
// of the DB claim below.
export function autoReplyGate(input: GateInput): { ok: true } | { ok: false; reason: SkipReason } {
  if (input.intentHandled) return { ok: false, reason: "intent_handled" };
  if (!input.contact) return { ok: false, reason: "no_contact" };
  if (!input.contact.autoReplyEnabled) return { ok: false, reason: "disabled" };
  if (input.contact.consentStatus === "OPTED_OUT") return { ok: false, reason: "opted_out" };
  return { ok: true };
}

export async function aiAutoReplyToWebhook(
  db: Db,
  rawBody: string,
  opts: {
    // Message ids already answered by the rich-menu intent handler. That handler
    // mutates `Contact.pendingIntent`, so this module cannot re-derive the answer
    // by re-classifying the text — the ids have to be passed in.
    handledMessageIds?: Iterable<string>;
    generate?: GenerateFn;
    send?: SendLineText;
  } = {},
): Promise<AutoReplyOutcome> {
  const parsed = parseLineWebhookPayload(rawBody);
  if (!parsed.ok) return { replied: 0, skipped: 0, failed: 0, leadIds: [] };

  const generate = opts.generate ?? ((ctx: ChatReplyContext) => generateChatReply(ctx));
  const send = opts.send ?? sendLineTextMessage;
  const handled = new Set(opts.handledMessageIds ?? []);

  const outcome: AutoReplyOutcome = { replied: 0, skipped: 0, failed: 0, leadIds: [] };

  for (const event of parsed.payload.events) {
    // Only text messages: `follow` events are welcomed by processFollowLifecycle,
    // and answering them here too would double-message a new friend.
    const msg = parseTextMessageEvent(event);
    if (!msg?.source.userId) continue;

    try {
      const res = await replyToOne(db, msg.source.userId, msg.message.id, msg.message.text, {
        intentHandled: handled.has(msg.message.id),
        generate,
        send,
      });
      if (res.status === "replied") {
        outcome.replied += 1;
        if (res.leadId) outcome.leadIds.push(res.leadId);
      } else if (res.status === "failed") {
        outcome.failed += 1;
      } else {
        outcome.skipped += 1;
      }
    } catch (err) {
      outcome.failed += 1;
      logger.warn("line.ai_autoreply.error", {
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  if (outcome.replied || outcome.failed) {
    logger.info("line.ai_autoreply.done", {
      replied: outcome.replied,
      skipped: outcome.skipped,
      failed: outcome.failed,
    });
  }
  return outcome;
}

type OneResult =
  | { status: "replied"; leadId: string | null }
  | { status: "failed" }
  | { status: "skipped"; reason: SkipReason };

async function replyToOne(
  db: Db,
  lineUserId: string,
  inboundMessageId: string,
  inboundText: string,
  deps: { intentHandled: boolean; generate: GenerateFn; send: SendLineText },
): Promise<OneResult> {
  const claimId = autoReplyProviderMessageId(inboundMessageId);

  const contact = await db.contact.findUnique({
    where: { lineUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      autoReplyEnabled: true,
      consentStatus: true,
      company: { select: { name: true } },
      leads: { select: { id: true, title: true, stage: true }, orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  const gate = autoReplyGate({
    intentHandled: deps.intentHandled,
    contact: contact ? { autoReplyEnabled: contact.autoReplyEnabled, consentStatus: contact.consentStatus } : null,
  });
  if (!gate.ok) {
    logger.info("line.ai_autoreply.skipped", { reason: gate.reason, inboundMessageId });
    return { status: "skipped", reason: gate.reason };
  }
  if (!contact) return { status: "skipped", reason: "no_contact" }; // unreachable; narrows the type

  // Cheap pre-check so a redelivery does not pay for a model call before losing the
  // claim below. The claim is still what guarantees single delivery.
  const already = await db.message.findUnique({ where: { providerMessageId: claimId }, select: { id: true } });
  if (already) return { status: "skipped", reason: "already_replied" };

  const lead = contact.leads[0] ?? null;
  const history = await db.message.findMany({
    where: { contactId: contact.id, channel: "LINE" },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true, createdAt: true },
  });

  const reply = await deps.generate({
    contactName: `${contact.firstName} ${contact.lastName}`.trim(),
    companyName: contact.company.name,
    lead: lead ? { title: lead.title, stage: lead.stage } : null,
    latestInbound: inboundText,
    history: history
      .reverse()
      .map((m) => ({ direction: m.direction, body: m.body, at: m.createdAt.toISOString() })),
  });

  // Claim the reply. A concurrent redelivery hits the unique index and is skipped.
  const messageId = randomUUID();
  try {
    await db.message.create({
      data: {
        id: messageId,
        leadId: lead?.id ?? null,
        contactId: contact.id,
        channel: "LINE",
        direction: "OUT",
        status: "DRAFT",
        body: reply.text,
        providerMessageId: claimId,
      },
    });
  } catch {
    return { status: "skipped", reason: "already_replied" };
  }

  const sent = await deps.send({
    to: lineUserId,
    text: reply.text,
    // Provider-level dedupe keyed off the inbound message, so even a retry that
    // somehow got past the DB claim cannot deliver the same reply twice.
    retryKey: retryKeyForMessageId(claimId),
  });

  if (!sent.ok) {
    // The row stays as a FAILED outbound draft: it surfaces in the lead's LINE
    // drafts panel where a rep can edit the situation and retry the send by hand.
    await db.message.update({ where: { id: messageId }, data: { status: "FAILED" } });
    if (lead) {
      await db.activity.create({
        data: {
          leadId: lead.id,
          userId: null,
          type: "LINE_OUT",
          body: `AI auto-reply send failed: ${sent.error}`,
          metadata: {
            kind: "AI_AUTO_REPLY",
            messageId,
            inboundMessageId,
            aiSource: reply.source,
            model: reply.model,
            retryable: sent.retryable,
            requestId: sent.requestId,
          },
        },
      });
    }
    logger.warn("line.ai_autoreply.send_failed", { messageId, error: sent.error, retryable: sent.retryable });
    return { status: "failed" };
  }

  await db.message.update({ where: { id: messageId }, data: { status: "SENT" } });
  if (lead) {
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: null, // no human actor: the AI sent this
        type: "LINE_OUT",
        body: `AI auto-reply sent: ${reply.text}`,
        metadata: {
          kind: "AI_AUTO_REPLY",
          messageId,
          inboundMessageId,
          aiSource: reply.source, // "ai" or "fallback" — how the text was produced
          model: reply.model,
          providerMessageId: sent.providerMessageId,
          mode: sent.mode,
          requestId: sent.requestId,
        },
      },
    });
  }

  logger.info("line.ai_autoreply.sent", {
    messageId,
    leadId: lead?.id ?? null,
    aiSource: reply.source,
    model: reply.model,
    mode: sent.mode,
  });
  return { status: "replied", leadId: lead?.id ?? null };
}

const AUTO_REPLY_ID_PREFIX = "line-ai:";

// The idempotency claim AND the marker that labels the message as AI-sent in the
// chat box (see isAutoReplyMessage).
export function autoReplyProviderMessageId(inboundMessageId: string): string {
  return `${AUTO_REPLY_ID_PREFIX}${inboundMessageId}`;
}

export function isAutoReplyMessage(providerMessageId: string | null): boolean {
  return providerMessageId?.startsWith(AUTO_REPLY_ID_PREFIX) ?? false;
}
