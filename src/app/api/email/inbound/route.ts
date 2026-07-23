import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { inboundEmailSchema, processInboundEmail } from "@/lib/email/inbound";
import { logger } from "@/lib/logger";

// This provider-facing endpoint needs Node crypto for constant-time shared-secret
// comparison. A gateway normalizes its provider webhook to the documented shape.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET?.trim();
  const presented = request.headers.get("x-email-webhook-secret");
  if (!secret || !presented || !secretsMatch(secret, presented)) {
    logger.warn("email.inbound.unauthorized", { secretConfigured: Boolean(secret), secretPresented: Boolean(presented) });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = inboundEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid inbound email payload" }, { status: 400 });
  }

  const result = await processInboundEmail(prisma, parsed.data);
  logger.info("email.inbound.processed", { status: result.status, leadId: result.status === "processed" ? result.leadId : null });

  if (result.status === "processed" && result.leadId) {
    revalidatePath(`/leads/${result.leadId}`);
    revalidatePath("/leads");
    revalidatePath("/board");
  }

  return NextResponse.json(result, { status: result.status === "unmapped" ? 202 : 200 });
}

function secretsMatch(expected: string, presented: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes);
}
