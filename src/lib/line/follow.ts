import type { PrismaClient } from "@prisma/client";
import { parseLineWebhookPayload, parseFollowEvent, parseUnfollowEvent } from "./payload";
import { replyLineTextMessage, type ReplyLineTextInput, type LineSendResult } from "./adapter";
import { logger } from "@/lib/logger";

// LINE friend-add / block lifecycle (PLAN §11.4 step 4):
//  - follow   → welcome NEW followers with the LIFF self-registration link.
//               Gated to "no Contact yet" so a known contact who re-adds the OA
//               isn't sent the registration link again. No contention with the AI
//               auto-reply: that path handles text messages only, and pushes rather
//               than competing for this single-use replyToken.
//  - unfollow → set the matched Contact to OPTED_OUT (they blocked the OA) —
//               PDPA hygiene; outbound already refuses OPTED_OUT. No replyToken.
//
// Best-effort: never throws, so a failure can't turn the webhook 200 into a 500.

type ReplyFn = (input: ReplyLineTextInput) => Promise<LineSendResult>;

function defaultLiffUrl(): string | null {
  const id = process.env.LINE_LIFF_ID?.trim();
  return id ? `https://liff.line.me/${id}` : null;
}

function welcomeText(url: string): string {
  return `สวัสดีครับ ยินดีต้อนรับสู่ J. AI CRM 🙏 ลงทะเบียนข้อมูลติดต่อเพื่อให้ทีมงานดูแลคุณได้สะดวกขึ้นที่นี่: ${url}`;
}

export async function processFollowLifecycle(
  db: PrismaClient,
  rawBody: string,
  opts: { reply?: ReplyFn; url?: string | null } = {},
): Promise<{ welcomed: number; optedOut: number; failed: number }> {
  const parsed = parseLineWebhookPayload(rawBody);
  if (!parsed.ok) return { welcomed: 0, optedOut: 0, failed: 0 };

  const reply = opts.reply ?? replyLineTextMessage;
  const url = opts.url === undefined ? defaultLiffUrl() : opts.url;
  let welcomed = 0;
  let optedOut = 0;
  let failed = 0;

  for (const event of parsed.payload.events) {
    const follow = parseFollowEvent(event);
    if (follow) {
      if (!follow.source.userId || !follow.replyToken || !url) continue;
      try {
        const existing = await db.contact.findUnique({
          where: { lineUserId: follow.source.userId },
          select: { id: true },
        });
        if (existing) continue; // already registered → auto-reply/normal flow handles it
        const res = await reply({ replyToken: follow.replyToken, text: welcomeText(url) });
        if (res.ok) welcomed += 1;
        else {
          failed += 1;
          logger.warn("line.follow.welcome_failed", { error: res.error });
        }
      } catch (err) {
        failed += 1;
        logger.warn("line.follow.error", { error: err instanceof Error ? err.message : "unknown" });
      }
      continue;
    }

    const unfollow = parseUnfollowEvent(event);
    if (unfollow?.source.userId) {
      try {
        const res = await db.contact.updateMany({
          where: { lineUserId: unfollow.source.userId },
          data: { consentStatus: "OPTED_OUT" },
        });
        if (res.count > 0) optedOut += 1;
      } catch (err) {
        failed += 1;
        logger.warn("line.unfollow.error", { error: err instanceof Error ? err.message : "unknown" });
      }
    }
  }

  if (welcomed > 0 || optedOut > 0 || failed > 0) logger.info("line.follow.done", { welcomed, optedOut, failed });
  return { welcomed, optedOut, failed };
}
