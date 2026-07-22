import type { Stage, Source, ActivityType, MessageDirection } from "@prisma/client";

// A plain, serialisable snapshot of a lead + its recent history. Both the Claude
// prompt and the deterministic fallback read from this — never from Prisma rows
// directly — so both paths see exactly the same facts and stay pure/testable.
export type CopilotContext = {
  leadId: string;
  title: string;
  stage: Stage;
  source: Source;
  valueTHB: number;
  score: number | null;
  company: { name: string; industry: string | null; size: string | null };
  contact: { name: string; title: string | null; consentStatus: string; hasLine: boolean };
  ownerName: string;
  activities: { type: ActivityType; body: string; at: string }[];
  messages: { direction: MessageDirection; body: string; at: string }[];
  daysSinceLastActivity: number | null; // null when there is no activity at all
  now: string; // ISO anchor, injectable for deterministic tests
};

type LeadWithRelations = {
  id: string;
  title: string;
  stage: Stage;
  source: Source;
  valueTHB: number;
  score: number | null;
  company: { name: string; industry: string | null; size: string | null };
  contact: { firstName: string; lastName: string; title: string | null; consentStatus: string; lineUserId: string | null };
  owner: { name: string };
  activities: { type: ActivityType; body: string; createdAt: Date }[];
  messages: { direction: MessageDirection; body: string; createdAt: Date }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Pure: Prisma row (with relations) → CopilotContext. `now` is injectable so the
// derived `daysSinceLastActivity` is deterministic under test.
export function buildCopilotContext(lead: LeadWithRelations, now: Date = new Date()): CopilotContext {
  const activityDates = lead.activities.map((a) => a.createdAt.getTime());
  const messageDates = lead.messages.map((m) => m.createdAt.getTime());
  const lastTouch = Math.max(0, ...activityDates, ...messageDates);
  const daysSinceLastActivity =
    lastTouch > 0 ? Math.floor((now.getTime() - lastTouch) / DAY_MS) : null;

  return {
    leadId: lead.id,
    title: lead.title,
    stage: lead.stage,
    source: lead.source,
    valueTHB: lead.valueTHB,
    score: lead.score,
    company: { name: lead.company.name, industry: lead.company.industry, size: lead.company.size },
    contact: {
      // Derived display name — keeps the whole AI layer (fallback/prompt/tests)
      // reading a single `contact.name` even though the DB stores it split.
      name: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
      title: lead.contact.title,
      consentStatus: lead.contact.consentStatus,
      hasLine: lead.contact.lineUserId != null,
    },
    ownerName: lead.owner.name,
    activities: lead.activities.map((a) => ({ type: a.type, body: a.body, at: a.createdAt.toISOString() })),
    messages: lead.messages.map((m) => ({ direction: m.direction, body: m.body, at: m.createdAt.toISOString() })),
    daysSinceLastActivity,
    now: now.toISOString(),
  };
}
