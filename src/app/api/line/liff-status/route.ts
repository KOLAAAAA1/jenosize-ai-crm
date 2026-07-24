import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { liffStatusSchema } from "@/lib/validation";
import { verifyLiffIdToken, loginChannelId } from "@/lib/line/liff-verify";
import { findLiffContact } from "@/lib/line/liff-register";

// Public: /liff calls this on load (no connect token) to decide whether to greet a
// returning, already-linked customer with their saved details, or show a blank
// registration form. Security = server-side ID-token verification (never trust a
// client-sent userId). Read-only. Node runtime for Prisma.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const channelId = loginChannelId();
  if (!channelId) return NextResponse.json({ error: "LIFF is not configured on the server." }, { status: 500 });

  const body = await req.json().catch(() => null);
  const parsed = liffStatusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const identity = await verifyLiffIdToken(parsed.data.idToken, channelId);
  if (!identity) return NextResponse.json({ error: "Could not verify your LINE identity." }, { status: 401 });

  const c = await findLiffContact(prisma, identity.userId);
  return NextResponse.json({
    linked: c != null,
    contact: c
      ? { firstName: c.firstName, lastName: c.lastName, email: c.email ?? "", phone: c.phone ?? "", consent: c.consentStatus === "OPTED_IN" }
      : null,
  });
}
