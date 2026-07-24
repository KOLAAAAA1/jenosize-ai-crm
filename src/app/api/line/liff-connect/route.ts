import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { liffConnectSchema } from "@/lib/validation";
import { verifyLiffIdToken, loginChannelId } from "@/lib/line/liff-verify";
import { verifyContactLinkToken } from "@/lib/line/link-token";
import { connectLineUserToContact } from "@/lib/line/liff-connect";
import { switchToMemberRichMenu } from "@/lib/line/richmenu";
import { logger } from "@/lib/logger";

// Public (no CRM session): the customer reaches this from the LIFF connect link.
// Security = server-side LINE ID-token verification + the signed link token; the
// customer never supplies the userId or the contactId directly. Node for Prisma.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const channelId = loginChannelId();
  if (!channelId) {
    logger.error("line.liff.misconfigured", { reason: "no LINE_LOGIN_CHANNEL_ID / LINE_LIFF_ID" });
    return NextResponse.json({ error: "LIFF is not configured on the server." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = liffConnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid connect request." }, { status: 400 });
  }

  // The link token carries the target contactId; reject expired/tampered/wrong-purpose.
  const contactId = await verifyContactLinkToken(parsed.data.token);
  if (!contactId) {
    return NextResponse.json({ error: "ลิงก์เชื่อมต่อไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่" }, { status: 401 });
  }

  const identity = await verifyLiffIdToken(parsed.data.idToken, channelId);
  if (!identity) {
    return NextResponse.json({ error: "ไม่สามารถยืนยันตัวตน LINE ของคุณได้" }, { status: 401 });
  }

  const result = await connectLineUserToContact(prisma, {
    lineUserId: identity.userId,
    contactId,
    consent: parsed.data.consent,
  });

  if (!result.ok) {
    if (result.reason === "contact_not_found") {
      return NextResponse.json({ error: "ไม่พบข้อมูลติดต่อปลายทาง" }, { status: 404 });
    }
    const error =
      result.reason === "contact_already_linked"
        ? "ข้อมูลติดต่อนี้เชื่อมต่อกับบัญชี LINE อื่นอยู่แล้ว กรุณาติดต่อทีมงาน"
        : "บัญชี LINE นี้ถูกเชื่อมต่อกับข้อมูลติดต่ออื่นแล้ว กรุณาติดต่อทีมงาน";
    return NextResponse.json({ error }, { status: 409 });
  }

  // Now connected → swap this user onto the member rich menu (best-effort).
  await switchToMemberRichMenu(identity.userId);

  logger.info("line.liff.connected", { outcome: result.outcome });
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
