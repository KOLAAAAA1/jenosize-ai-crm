import { logger } from "@/lib/logger";

// Per-user rich menu control. LINE lets you link a specific rich menu to one user
// (`POST /v2/bot/user/{userId}/richmenu/{id}`), which overrides the default menu
// for that user only — so a customer who has connected via LIFF can be swapped
// off the "register/connect" guest menu onto the member menu.

export async function linkRichMenuToUser(userId: string, richMenuId: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };

  const res = await fetch(`https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` };
  return { ok: true };
}

// Best-effort: switch a just-connected user onto the member rich menu. Gated on
// config (LINE_ENABLED + a provisioned member menu id) and **never throws** — a
// rich-menu failure must not break registration/connection. Idempotent.
export async function switchToMemberRichMenu(userId: string): Promise<void> {
  const memberId = process.env.LINE_MEMBER_RICHMENU_ID?.trim();
  if (process.env.LINE_ENABLED !== "true" || !memberId) return;
  try {
    const res = await linkRichMenuToUser(userId, memberId);
    if (!res.ok) logger.warn("line.richmenu.switch_failed", { error: res.error });
  } catch (err) {
    logger.warn("line.richmenu.switch_error", { error: err instanceof Error ? err.message : "unknown error" });
  }
}
