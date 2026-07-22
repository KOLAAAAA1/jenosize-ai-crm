import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

// Re-export the framework-agnostic pieces so existing importers (login/logout
// routes, layouts) can keep importing from "@/lib/auth".
export {
  SESSION_COOKIE,
  signSession,
  verifySession,
  verifyPassword,
  sessionCookieOptions,
  type SessionUser,
} from "./session";

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies(); // async in Next 15+/16
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

// Page guard (Server Components / route-group layouts): redirect if unauthenticated.
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// API guard (Route Handlers): returns the user, or a 401 NextResponse to return early.
export async function requireApiUser(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}
