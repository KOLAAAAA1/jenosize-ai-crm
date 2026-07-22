// Per-contact greeting auto-reply for the LINE OA.
//
// The production design is receive-only: real sales replies always go through the
// human approve-&-send path (outbound.ts). This module is a narrow, opt-in
// exception: it sends a canned greeting ONLY to customers a sale/admin has toggled
// on via `Contact.autoReplyEnabled` (default false → no reply for anyone). A
// brand-new follower with no Contact, or one with the toggle off, gets nothing.
//
// This does NOT touch the AI copilot — the reply is a fixed string, never model output.
//
// Intentional simplifications (kept deliberately narrow):
//   - writes NO `LINE_OUT` Activity (no CRM audit row),
//   - does NOT check `Contact.consentStatus` / OPTED_OUT.
// A user-initiated greeting reply to an explicitly opted-in contact makes both
// defensible; the real outreach path keeps both.
//
// ⚠️ Console interaction: if the LINE OA Manager still has *Greeting messages* or a
// keyword *Auto-reply* enabled, the platform may consume the single-use replyToken
// first, so this reply can come back `400 Invalid reply token`. For a clean test,
// disable those in Response settings, and prefer the greeting-TEXT path (send
// "สวัสดี" as a message) over re-firing `follow` (which needs block + re-add).
import { parseLineWebhookPayload, parseTextMessageEvent, parseFollowEvent } from "./payload";
import { replyLineTextMessage, type ReplyLineTextInput, type LineSendResult } from "./adapter";
import { logger } from "@/lib/logger";

const GREETINGS = ["สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ", "hello", "hi", "hey"];

export const GREETING_REPLY_TEXT = "สวัสดีครับ ยินดีต้อนรับสู่ J. AI CRM 🙏 พิมพ์สอบถามได้เลย เดี๋ยวทีมงานติดต่อกลับครับ";

export function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase();
  return GREETINGS.some((g) => t.startsWith(g.toLowerCase()));
}

type ReplyFn = (input: ReplyLineTextInput) => Promise<LineSendResult>;

// Resolves whether the auto-reply toggle is ON for a given LINE user. The route
// backs this with a `Contact.autoReplyEnabled` lookup; tests inject a fake.
type IsEnabledForUser = (lineUserId: string) => Promise<boolean>;

// Best-effort: never throws. Called after ingestion in the webhook route, so a
// reply failure must not turn the 200 into a 500 (which would make LINE retry the
// whole webhook against an already-expired token).
export async function autoReplyToWebhook(
  rawBody: string,
  opts: { isEnabledForUser: IsEnabledForUser; reply?: ReplyFn },
): Promise<{ replied: number; failed: number }> {
  const parsed = parseLineWebhookPayload(rawBody);
  if (!parsed.ok) return { replied: 0, failed: 0 };

  const reply = opts.reply ?? replyLineTextMessage;
  let replied = 0;
  let failed = 0;

  for (const event of parsed.payload.events) {
    const target = eligibleGreeting(event);
    if (!target) continue;

    // Per-contact gate: only reply if a sale/admin turned it on for this customer.
    let enabled = false;
    try {
      enabled = await opts.isEnabledForUser(target.userId);
    } catch (err) {
      logger.warn("line.autoreply.lookup_error", { error: err instanceof Error ? err.message : "unknown" });
      continue;
    }
    if (!enabled) continue;

    try {
      const res = await reply({ replyToken: target.replyToken, text: GREETING_REPLY_TEXT });
      if (res.ok) replied += 1;
      else {
        failed += 1;
        logger.warn("line.autoreply.failed", { error: res.error });
      }
    } catch (err) {
      failed += 1;
      logger.warn("line.autoreply.error", { error: err instanceof Error ? err.message : "unknown" });
    }
  }

  if (replied > 0 || failed > 0) logger.info("line.autoreply.done", { replied, failed });
  return { replied, failed };
}

// An event is eligible for a greeting reply when it is a `follow`, or a text
// message whose body starts with a greeting word. Both a `userId` (for the
// per-contact toggle lookup) and a `replyToken` are required.
function eligibleGreeting(event: unknown): { userId: string; replyToken: string } | null {
  const follow = parseFollowEvent(event);
  if (follow?.source.userId && follow.replyToken) {
    return { userId: follow.source.userId, replyToken: follow.replyToken };
  }

  const message = parseTextMessageEvent(event);
  if (message?.source.userId && message.replyToken && isGreeting(message.message.text)) {
    return { userId: message.source.userId, replyToken: message.replyToken };
  }

  return null;
}
