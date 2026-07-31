import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const POST = logout;

async function logout() {
  const res = NextResponse.json({ ok: true });
  // Expire the session cookie immediately.
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
