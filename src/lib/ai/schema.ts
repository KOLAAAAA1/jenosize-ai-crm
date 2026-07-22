import { z } from "zod";

// Literal tuple for z.enum (must be literals, not a widened Stage[]). Kept in
// sync with the Prisma `Stage` enum; `no_change` means "don't recommend a move".
const RECOMMENDED_STAGES = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST", "no_change"] as const;

// The content a copilot run produces — identical shape whether it comes from
// Claude (structured output) or the deterministic fallback. This single schema
// is the SDK's `output_config.format`, the fallback validator, and the "schema-
// valid" assertion in the fallback test. A flattened subset of the SKILL.md
// output contract — enough to display and review; suggested_writes / evidence
// stay out of the MVP payload while LINE drafts are saved as reviewed Messages.
//
// NOTE: JSON-Schema structured outputs reject numeric min/max, so `score` is a
// plain nullable number — the 0–100 clamp lives in code (see clampScore).
export const copilotResultSchema = z.object({
  status: z.enum(["success", "insufficient_context", "service_unavailable"]),
  summary: z.object({
    overview: z.string(),
    keyFacts: z.array(z.string()),
    openQuestions: z.array(z.string()),
  }),
  qualification: z.object({
    score: z.number().nullable(),
    confidence: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string()),
    recommendedStage: z.enum(RECOMMENDED_STAGES),
  }),
  nextAction: z
    .object({
      action: z.string(),
      reason: z.string(),
      priority: z.enum(["low", "medium", "high"]),
    })
    .nullable(),
  lineReply: z
    .object({
      draft: z.string().nullable(),
      requiresApproval: z.literal(true),
    })
    .nullable(),
  warnings: z.array(z.string()),
});

export type CopilotResult = z.infer<typeof copilotResultSchema>;

// The persisted/returned suggestion = the model content plus run metadata that
// the model never generates (provenance + timestamp).
export type CopilotSuggestion = CopilotResult & {
  source: "ai" | "fallback";
  model: string; // model id (ai) or "deterministic" (fallback)
  generatedAt: string; // ISO-8601
};

export function clampScore(score: number | null): number | null {
  if (score == null || Number.isNaN(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}
