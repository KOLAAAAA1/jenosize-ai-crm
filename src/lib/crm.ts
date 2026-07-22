import type { Stage, Source, ActivityType, MessageDirection, MessageStatus, ConsentStatus } from "@prisma/client";

export const STAGES: readonly Stage[] = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
export const SOURCES: readonly Source[] = ["WEBSITE", "MANUAL", "LINE_OA"];

// Controlled vocabularies shared by the seed, the filter dropdowns, and the
// create/edit forms so options never drift from the data.
export const INDUSTRIES = [
  "Retail", "Finance", "Manufacturing", "Healthcare", "Technology",
  "Logistics", "Hospitality", "Education", "Real Estate", "Media",
] as const;
export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

export const CONSENT_STATUSES: readonly ConsentStatus[] = ["UNKNOWN", "OPTED_IN", "OPTED_OUT"];
export const CONSENT_META: Record<ConsentStatus, { label: string; badge: string }> = {
  UNKNOWN: { label: "Unknown", badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  OPTED_IN: { label: "Opted in", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  OPTED_OUT: { label: "Opted out", badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export const STAGE_META: Record<Stage, { label: string; badge: string; dot: string }> = {
  NEW: { label: "New", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", dot: "bg-zinc-400" },
  QUALIFIED: { label: "Qualified", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", dot: "bg-blue-500" },
  PROPOSAL: { label: "Proposal", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500" },
  WON: { label: "Won", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500" },
  LOST: { label: "Lost", badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", dot: "bg-red-500" },
};

export const SOURCE_META: Record<Source, string> = {
  WEBSITE: "Website",
  MANUAL: "Manual",
  LINE_OA: "LINE OA",
};

export const ACTIVITY_META: Record<ActivityType, { label: string; icon: string }> = {
  NOTE: { label: "Note", icon: "✎" },
  CALL: { label: "Call", icon: "☎" },
  EMAIL: { label: "Email", icon: "✉" },
  STAGE_CHANGE: { label: "Stage change", icon: "⇄" },
  AI_SUGGESTION: { label: "AI suggestion", icon: "✦" },
  LINE_IN: { label: "LINE in", icon: "↙" },
  LINE_OUT: { label: "LINE out", icon: "↗" },
};

export const MESSAGE_STATUS_META: Record<MessageStatus, string> = {
  RECEIVED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  SENT: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function messageDirectionLabel(d: MessageDirection): string {
  return d === "IN" ? "Inbound" : "Outbound";
}

export function isStage(v: string | undefined): v is Stage {
  return !!v && (STAGES as readonly string[]).includes(v);
}

export function isSource(v: string | undefined): v is Source {
  return !!v && (SOURCES as readonly string[]).includes(v);
}

export function isConsentStatus(v: string | undefined): v is ConsentStatus {
  return !!v && (CONSENT_STATUSES as readonly string[]).includes(v);
}

// Single display name from a contact's split name fields. Contacts store
// firstName/lastName separately (easier search/filter); this is the one place
// that composes them so every screen renders the name identically.
export function contactName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}
