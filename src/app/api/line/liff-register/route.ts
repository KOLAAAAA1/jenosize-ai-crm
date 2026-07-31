import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { liffRegisterSchema } from "@/lib/validation";
import { verifyLiffIdToken, loginChannelId } from "@/lib/line/liff-verify";
import { registerLiffContact } from "@/lib/line/liff-register";
import { switchToMemberRichMenu } from "@/lib/line/richmenu";
import { logger } from "@/lib/logger";

// Public (no CRM session): customers reach this from the LIFF page. Security is the
// server-side ID-token verification below, not a session. Prisma needs Node runtime.
export const runtime = "nodejs";

export const POST = liffRegister;

async function liffRegister(req: Request) {
  const channelId = loginChannelId();
  if (!channelId) {
    logger.error("line.liff.misconfigured", { reason: "no LINE_LOGIN_CHANNEL_ID / LINE_LIFF_ID" });
    return NextResponse.json({ error: "LIFF is not configured on the server." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = liffRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const identity = await verifyLiffIdToken(parsed.data.idToken, channelId);
  if (!identity) {
    return NextResponse.json({ error: "Could not verify your LINE identity." }, { status: 401 });
  }

  const result = await registerLiffContact(prisma, {
    userId: identity.userId,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    consent: parsed.data.consent,
  });

  // Now connected → swap this user onto the member rich menu (best-effort).
  await switchToMemberRichMenu(identity.userId);

  logger.info("line.liff.registered", { created: result.created });
  return NextResponse.json({ ok: true, created: result.created });
}
