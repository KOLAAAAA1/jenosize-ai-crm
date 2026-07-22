import type { Stage, Source } from "@prisma/client";
import type { CopilotContext } from "./context";
import { clampScore, type CopilotResult } from "./schema";
import { formatTHB } from "@/lib/format";

// Deterministic, rule-based fallback used when the model service is unavailable
// (or no API key is configured). Per SKILL.md "Model service unavailable": a
// rule-based score from stage + activity recency + source, a summary templated
// from stored fields, and NO fabricated model output — no invented prose
// summary, no model-style reasoning, no LINE draft. Every value here is
// mechanically derived from the context so the output is fully reproducible.

const STAGE_BASE: Record<Stage, number> = {
  NEW: 30,
  QUALIFIED: 55,
  PROPOSAL: 70,
  WON: 95,
  LOST: 10,
};

const SOURCE_BONUS: Record<Source, number> = {
  LINE_OA: 5,
  WEBSITE: 3,
  MANUAL: 0,
};

function recencyAdjustment(days: number | null): { delta: number; label: string } {
  if (days == null) return { delta: -5, label: "no recorded activity yet" };
  if (days <= 7) return { delta: 10, label: `active in the last ${days} day(s)` };
  if (days <= 30) return { delta: 5, label: `last activity ${days} days ago` };
  return { delta: -5, label: `stale — no activity for ${days} days` };
}

// Pure: CopilotContext → deterministic CopilotResult. Score inputs are exactly
// the three the spec names (stage, recency, source); `reasons` is their
// breakdown, not model reasoning.
export function deterministicFallback(ctx: CopilotContext): CopilotResult {
  const base = STAGE_BASE[ctx.stage];
  const recency = recencyAdjustment(ctx.daysSinceLastActivity);
  const sourceBonus = SOURCE_BONUS[ctx.source];
  const score = clampScore(base + recency.delta + sourceBonus);

  const reasons = [
    `Stage ${ctx.stage} → base ${base}`,
    `Recency: ${recency.label} (${recency.delta >= 0 ? "+" : ""}${recency.delta})`,
    `Source ${ctx.source} (+${sourceBonus})`,
  ];

  // Mechanically-derived next action, tied only to recency/consent — never
  // model-flavored. Suppress outreach entirely when the contact has opted out.
  const optedOut = ctx.contact.consentStatus === "OPTED_OUT";
  const stale = ctx.daysSinceLastActivity == null || ctx.daysSinceLastActivity > 30;
  const nextAction = optedOut
    ? {
        action: `Do not contact ${ctx.contact.name} — consent is OPTED_OUT`,
        reason: "Contact has opted out; outreach is blocked until consent changes.",
        priority: "low" as const,
      }
    : {
        action: stale
          ? `Follow up with ${ctx.contact.name} at ${ctx.company.name}`
          : `Continue engagement with ${ctx.contact.name}`,
        reason: stale
          ? `No activity for ${ctx.daysSinceLastActivity ?? "any recorded"} days.`
          : "Recent activity present; keep momentum.",
        priority: (stale ? "high" : "medium") as "high" | "medium",
      };

  const overview =
    `${ctx.title} — ${ctx.company.name}${ctx.company.industry ? ` (${ctx.company.industry})` : ""}. ` +
    `Stage ${ctx.stage}, source ${ctx.source}, value ${formatTHB(ctx.valueTHB)}, owner ${ctx.ownerName}. ` +
    `${ctx.daysSinceLastActivity == null ? "No activity recorded yet." : `Last activity ${ctx.daysSinceLastActivity} day(s) ago.`}`;

  const keyFacts = [
    `Company size: ${ctx.company.size ?? "unknown"}`,
    `Contact: ${ctx.contact.name}${ctx.contact.title ? `, ${ctx.contact.title}` : ""}`,
    `LINE linked: ${ctx.contact.hasLine ? "yes" : "no"} · consent: ${ctx.contact.consentStatus}`,
    `Activities on record: ${ctx.activities.length}, messages: ${ctx.messages.length}`,
  ];

  return {
    status: "service_unavailable",
    summary: {
      overview,
      keyFacts,
      openQuestions: ctx.score == null ? ["Lead has not been qualified yet."] : [],
    },
    qualification: {
      score,
      confidence: "low",
      reasons,
      // Fallback never recommends a stage change — a stage move must not rest on
      // a rule-based score (SKILL.md: never Won/Lost on a score alone).
      recommendedStage: "no_change",
    },
    nextAction,
    lineReply: null, // no conversation-grounded draft in fallback mode
    warnings: [
      "AI suggestions are temporarily unavailable — this is a deterministic fallback derived from stored CRM fields, not a model-generated result.",
    ],
  };
}
