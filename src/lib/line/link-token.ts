import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "@/lib/session";

// A short-lived, signed token that binds a *specific* CRM contact to a LINE
// account-link attempt. An officer mints one (see the contact page), embeds it in
// the LIFF URL, and the customer opens it in LINE; the server then binds the
// customer's *verified* lineUserId to the contactId carried inside this token —
// so the customer can never rebind to someone else's record.
//
// It is signed HS256 over the same AUTH_SECRET as the session JWT, so the
// `purpose` claim below is load-bearing: without it a link token (which travels
// in URLs) and a session token would be interchangeable. verifyContactLinkToken
// rejects anything whose purpose isn't exactly LINK_PURPOSE.

const LINK_PURPOSE = "line-contact-link";
const DEFAULT_TTL_SECONDS = 30 * 60; // 30 min — enough to open in LINE, short enough to expire

export async function signContactLinkToken(contactId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<string> {
  return new SignJWT({ purpose: LINK_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(contactId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSecret());
}

// Returns the contactId only for a well-formed, unexpired token carrying the
// exact link purpose. Any failure (expired, tampered, wrong/absent purpose, a
// session token) reads as null — never throws.
export async function verifyContactLinkToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== LINK_PURPOSE) return null;
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
