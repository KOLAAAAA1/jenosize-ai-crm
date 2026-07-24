// Rich-menu keyword automation & lead capture (PLAN §5 / FSD §3.5).
//
// Runs after processLineWebhook in the route (like autoreply/follow): best-effort,
// re-parses the raw body, replies via a single-use replyToken, and is mockable via
// an injected `reply`. Idempotency: the inquiry→lead capture atomically claims
// `Contact.pendingIntent` (AWAITING_INQUIRY → null) inside the same transaction as
// the lead creation, so a redelivery/duplicate can't create a second lead — and if
// creation throws, the claim rolls back so the intent survives for a retry.
import type { PrismaClient } from "@prisma/client";
import { parseLineWebhookPayload, parseTextMessageEvent, type LineTextMessageEvent } from "./payload";
import { replyLineTextMessage, type ReplyLineTextInput, type LineSendResult } from "./adapter";
import { logger } from "@/lib/logger";

type Db = PrismaClient;
type ReplyFn = (input: ReplyLineTextInput) => Promise<LineSendResult>;

export const CONTACT_TEAM_KEYWORD = "ขอติดต่อทีมงาน";
export const INQUIRY_KEYWORD = "ขอสอบถามข้อมูลเพิ่มเติม";

const CONTACT_TEAM_REPLY = "รับเรื่องแล้วครับ ✓ ทีมงานจะติดต่อกลับโดยเร็วที่สุด";
const INQUIRY_START_REPLY =
  "ยินดีให้ข้อมูลครับ 🙏 รบกวนแจ้ง (1) สินค้า/บริการที่สนใจ (2) ความต้องการ และ (3) งบประมาณโดยประมาณ แล้วทีมขายจะติดต่อกลับพร้อมรายละเอียดครับ";
const INQUIRY_CAPTURE_REPLY = "ได้รับข้อมูลแล้วครับ ✓ ทีมขายจะติดต่อกลับพร้อมรายละเอียดโดยเร็วครับ";

export type IntentKind = "contact_team" | "inquiry_start" | "inquiry_capture" | "none";

// Pure: text + current pending state → intent + the canned reply. Keyword match is
// exact (these come from rich-menu message actions); while AWAITING_INQUIRY, any
// other text is captured as the inquiry detail.
export function classifyIntent(text: string, pendingIntent: string | null): { kind: IntentKind; replyText: string } {
  const t = text.trim();
  if (t === CONTACT_TEAM_KEYWORD) return { kind: "contact_team", replyText: CONTACT_TEAM_REPLY };
  if (t === INQUIRY_KEYWORD) return { kind: "inquiry_start", replyText: INQUIRY_START_REPLY };
  if (pendingIntent === "AWAITING_INQUIRY") return { kind: "inquiry_capture", replyText: INQUIRY_CAPTURE_REPLY };
  return { kind: "none", replyText: "" };
}

function leadTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return `สอบถามผ่าน LINE — ${oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine}`;
}

// Env-first, then the earliest ADMIN/MANAGER (stable order). Captured leads need an
// owner (Lead.ownerId is Restrict); auto round-robin routing is a separate P1 item.
async function defaultOwnerId(db: Db): Promise<string | null> {
  const envId = process.env.LINE_LEAD_DEFAULT_OWNER_ID?.trim();
  if (envId) return envId;
  const owner = await db.user.findFirst({
    where: { role: { in: ["ADMIN", "MANAGER"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return owner?.id ?? null;
}

export async function handleInboundIntents(
  db: Db,
  rawBody: string,
  opts: { reply?: ReplyFn; resolveOwnerId?: (db: Db) => Promise<string | null> } = {},
): Promise<{ replied: number; leadsCreated: number }> {
  const parsed = parseLineWebhookPayload(rawBody);
  if (!parsed.ok) return { replied: 0, leadsCreated: 0 };

  const reply = opts.reply ?? replyLineTextMessage;
  const resolveOwnerId = opts.resolveOwnerId ?? defaultOwnerId;

  let replied = 0;
  let leadsCreated = 0;
  for (const event of parsed.payload.events) {
    const msg = parseTextMessageEvent(event);
    if (!msg?.source.userId || !msg.replyToken) continue;
    try {
      const r = await handleOne(db, msg, reply, resolveOwnerId);
      replied += r.replied;
      leadsCreated += r.leadsCreated;
    } catch (err) {
      logger.warn("line.intents.error", { error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  if (replied || leadsCreated) logger.info("line.intents.done", { replied, leadsCreated });
  return { replied, leadsCreated };
}

async function handleOne(
  db: Db,
  msg: LineTextMessageEvent,
  reply: ReplyFn,
  resolveOwnerId: (db: Db) => Promise<string | null>,
): Promise<{ replied: number; leadsCreated: number }> {
  const userId = msg.source.userId!;
  const replyToken = msg.replyToken!;
  const isRedelivery = msg.deliveryContext?.isRedelivery ?? false;

  const contact = await db.contact.findUnique({
    where: { lineUserId: userId },
    select: { id: true, companyId: true, pendingIntent: true, leads: { select: { id: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!contact) return { replied: 0, leadsCreated: 0 };

  const intent = classifyIntent(msg.message.text, contact.pendingIntent);
  let leadsCreated = 0;

  if (intent.kind === "none") return { replied: 0, leadsCreated: 0 };

  if (intent.kind === "contact_team") {
    if (isRedelivery) return { replied: 0, leadsCreated: 0 };
    const leadId = contact.leads[0]?.id;
    if (leadId) {
      await db.activity.create({
        data: { leadId, userId: null, type: "NOTE", body: "ลูกค้าขอให้ทีมงานติดต่อกลับ (LINE rich menu)", metadata: { via: "line_rich_menu", lineUserId: userId } },
      });
    }
  } else if (intent.kind === "inquiry_start") {
    await db.contact.update({ where: { id: contact.id }, data: { pendingIntent: "AWAITING_INQUIRY" } });
  } else {
    // inquiry_capture: turn the customer's detail into a NEW lead for sales.
    const ownerId = await resolveOwnerId(db);
    if (!ownerId) {
      logger.warn("line.intents.no_default_owner", {}); // leave pendingIntent set; nothing lost
      return { replied: 0, leadsCreated: 0 };
    }
    const text = msg.message.text.trim();
    const created = await db.$transaction(async (tx) => {
      // Atomic claim: only the delivery that flips AWAITING→null creates the lead.
      const claim = await tx.contact.updateMany({ where: { id: contact.id, pendingIntent: "AWAITING_INQUIRY" }, data: { pendingIntent: null } });
      if (claim.count === 0) return false; // already captured (duplicate / redelivery)
      const lead = await tx.lead.create({
        data: { title: leadTitle(text), companyId: contact.companyId, contactId: contact.id, ownerId, source: "LINE_OA", stage: "NEW" },
        select: { id: true },
      });
      await tx.activity.create({
        data: { leadId: lead.id, userId: null, type: "LINE_IN", body: `สอบถามข้อมูลผ่าน LINE: ${text}`, metadata: { via: "line_rich_menu_inquiry", lineUserId: userId } },
      });
      return true;
    });
    if (!created) return { replied: 0, leadsCreated: 0 }; // duplicate → no reply
    leadsCreated = 1;
  }

  let replied = 0;
  try {
    const res = await reply({ replyToken, text: intent.replyText });
    if (res.ok) replied = 1;
    else logger.warn("line.intents.reply_failed", { error: res.error });
  } catch (err) {
    logger.warn("line.intents.reply_error", { error: err instanceof Error ? err.message : "unknown error" });
  }
  return { replied, leadsCreated };
}
