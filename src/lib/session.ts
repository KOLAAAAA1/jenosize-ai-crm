import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

// Framework-agnostic session + password logic (no next/server-only imports),
// so it is directly unit-testable. The Next-bound cookie/redirect helpers live
// in ./auth and build on this module.

export const SESSION_COOKIE = "crm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

// AUTH_SECRET is required in production; a dev-only fallback keeps local setup
// frictionless.
export function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production.");
  }
  return new TextEncoder().encode("dev-only-insecure-secret-change-me");
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

// Any failure (expired, tampered, malformed) reads as "logged out", never throws.
export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as UserRole,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  // secure cookies are dropped over http://localhost — must be false in dev.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

// Constant-time-ish password check: always run a bcrypt compare (against a dummy
// hash when the user is missing) so timing doesn't reveal whether an email exists.
const DUMMY_HASH = bcrypt.hashSync("unused-placeholder-for-timing", 10);
export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash ? ok : false;
}
