import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordInvalidLineWebhook, processLineWebhook } from "@/lib/line/service";
import { autoReplyToWebhook } from "@/lib/line/autoreply";
import { processFollowLifecycle } from "@/lib/line/follow";
import { verifyLineSignature } from "@/lib/line/signature";
import { logger } from "@/lib/logger";

// HMAC verification uses Node crypto, and the handler reads the raw body.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature({ body: rawBody, signature, channelSecret: process.env.LINE_CHANNEL_SECRET })) {
    await recordInvalidLineWebhook(prisma, rawBody, signature);
    logger.warn("line.webhook.invalid_signature", {
      signaturePresent: signature != null,
      bodyBytes: rawBody.length,
    });
    return NextResponse.json({ status: "blocked", error: "Invalid LINE signature" }, { status: 401 });
  }

  const result = await processLineWebhook(prisma, rawBody);

  // Per-contact greeting auto-reply — only for customers a sale/admin toggled on
  // (Contact.autoReplyEnabled, default false). Best-effort and self-contained: a
  // reply failure must never turn this 200 into a 500, or LINE would retry the
  // whole webhook against an already-expired replyToken.
  await autoReplyToWebhook(rawBody, {
    isEnabledForUser: async (lineUserId) => {
      const contact = await prisma.contact.findUnique({
        where: { lineUserId },
        select: { autoReplyEnabled: true },
      });
      return contact?.autoReplyEnabled ?? false;
    },
  });

  // Friend-add / block lifecycle: welcome new followers with the LIFF link,
  // opt-out contacts who blocked the OA. Best-effort (never throws).
  await processFollowLifecycle(prisma, rawBody);

  if (result.status === "invalid") {
    logger.warn("line.webhook.invalid_payload", { error: result.error });
    return NextResponse.json({ status: "failed", error: result.error }, { status: 400 });
  }

  logger.info("line.webhook.processed", {
    status: result.status,
    processed: result.processed,
    duplicates: result.duplicates,
    unmapped: result.unmapped,
    ignored: result.ignored,
  });

  if (result.processed > 0) {
    safeRevalidatePath("/leads");
    safeRevalidatePath("/board");
  }

  return NextResponse.json(result);
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") throw err;
  }
}
