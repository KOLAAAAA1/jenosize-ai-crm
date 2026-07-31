import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordInvalidLineWebhook, processLineWebhook } from "@/lib/line/service";
import { aiAutoReplyToWebhook } from "@/lib/line/ai-autoreply";
import { processFollowLifecycle } from "@/lib/line/follow";
import { handleInboundIntents } from "@/lib/line/inbound-intents";
import { verifyLineSignature } from "@/lib/line/signature";
import { logger } from "@/lib/logger";

// HMAC verification uses Node crypto, and the handler reads the raw body.
export const runtime = "nodejs";
// The AI auto-reply runs after the response (see afterResponse) but still inside
// the route's budget. Its model call is capped at 20s; this leaves room for a slow
// provider plus the send, without inheriting the copilot's 5-minute ceiling.
export const maxDuration = 60;

export const POST = lineWebhook;

async function lineWebhook(req: Request) {
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

  // Friend-add / block lifecycle: welcome new followers with the LIFF link,
  // opt-out contacts who blocked the OA. Best-effort (never throws).
  await processFollowLifecycle(prisma, rawBody);

  // Rich-menu keyword automation & inquiry→lead capture (PLAN §5). Best-effort;
  // idempotent side effects (atomic pendingIntent claim) live in the module.
  //
  // Runs BEFORE the AI auto-reply for two reasons: an inquiry capture creates the
  // Lead the AI reply then attaches to, and `handledMessageIds` tells the AI which
  // messages the canned keyword replies already answered. Without that hand-off a
  // rich-menu tap would get two replies.
  const intents = await handleInboundIntents(prisma, rawBody);

  // AI auto-reply — the default answer to an ordinary inbound message, on unless a
  // sale/admin switched `Contact.autoReplyEnabled` off for that customer. Persists
  // the reply as Message(OUT) + Activity so it shows in the lead's chat box and
  // audit timeline. Best-effort and self-contained: a failure here must never turn
  // this 200 into a 500.
  //
  // Deferred past the response because generating the reply takes seconds (a
  // free-tier model is routinely 10s+) and LINE should not be kept waiting for it.
  await afterResponse(async () => {
    // Belt and braces: the module never throws, but this runs detached from the
    // request, where an escaping error has no response to fail into — and
    // safeRevalidatePath deliberately rethrows outside tests.
    try {
      const autoReply = await aiAutoReplyToWebhook(prisma, rawBody, {
        handledMessageIds: intents.handledMessageIds,
      });
      for (const leadId of new Set(autoReply.leadIds)) safeRevalidatePath(`/leads/${leadId}`);
    } catch (err) {
      logger.warn("line.webhook.autoreply_failed", { error: err instanceof Error ? err.message : "unknown error" });
    }
  });

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

// Runs `work` after the response is sent, so the client (LINE) is not kept waiting.
// `after` needs a Next request scope and throws without one — which is exactly the
// case when a test invokes this handler directly, so there the work runs inline and
// the caller can await it.
function afterResponse(work: () => Promise<void>): Promise<void> | void {
  try {
    after(work);
  } catch {
    return work();
  }
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") throw err;
  }
}
