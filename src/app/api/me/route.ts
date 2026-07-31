import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";

export const runtime = "nodejs";

// Protected endpoint: returns the current session user, or 401 if unauthenticated.
export const GET = getMe;

async function getMe() {
  const auth = await requireApiUser();
  if (auth instanceof NextResponse) return auth; // 401
  return NextResponse.json({ user: auth });
}
