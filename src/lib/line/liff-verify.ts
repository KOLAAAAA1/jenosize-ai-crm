// Server-side verification of a LIFF ID token.
//
// The LIFF client sends an OpenID `id_token` (from `liff.getIDToken()`); we NEVER
// trust a client-supplied userId. We POST the token to LINE's verify endpoint with
// the Login channel id as `client_id`; LINE validates the signature/audience/expiry
// and returns the trusted `sub` (the LINE userId) and `name`.
//
// The channel id is `LINE_LOGIN_CHANNEL_ID` if set, else derived from the LIFF id
// prefix (`<channelId>-<suffix>`).
import { logger } from "@/lib/logger";

export type LiffIdentity = { userId: string; displayName: string | null };

export function loginChannelId(): string | null {
  const explicit = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  if (explicit) return explicit;
  const liffId = process.env.LINE_LIFF_ID?.trim();
  const derived = liffId?.split("-")[0]?.trim();
  return derived && derived.length > 0 ? derived : null;
}

export async function verifyLiffIdToken(idToken: string, channelId: string): Promise<LiffIdentity | null> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn("line.liff.verify_failed", { status: res.status, detail: detail.slice(0, 200) });
    return null;
  }

  const json = (await res.json().catch(() => null)) as { sub?: unknown; name?: unknown } | null;
  const userId = typeof json?.sub === "string" ? json.sub : null;
  if (!userId) return null;

  return { userId, displayName: typeof json?.name === "string" ? json.name : null };
}
