import type { CopilotContext } from "./context";
import { copilotResultSchema, clampScore, type CopilotResult, type CopilotSuggestion } from "./schema";
import { deterministicFallback } from "./fallback";
import { logger } from "@/lib/logger";

// The single seam that makes this testable without a network or a DB: the model
// call is an injected dependency. Tests pass a `callModel` that throws and assert
// the result falls back deterministically. Production passes nothing and the real
// Anthropic client is used — but only when a key is actually configured.
export type CallModel = (ctx: CopilotContext) => Promise<CopilotResult>;

export const DEFAULT_MODEL = process.env.CRM_AI_MODEL ?? "claude-opus-4-8";

function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

// Orchestrates one copilot run. No DB, no Next imports — the caller loads the
// context and persists the result. Any failure (thrown callModel, invalid
// output, missing key) degrades to the deterministic fallback; the happy path is
// schema-validated and score-clamped before it is trusted.
export async function generateSuggestion(
  ctx: CopilotContext,
  opts: { callModel?: CallModel } = {},
): Promise<CopilotSuggestion> {
  const generatedAt = new Date().toISOString();

  // Route straight to the fallback when there is nothing to call — never build a
  // client just to eat a slow failure.
  const injected = opts.callModel != null;
  const callModel = opts.callModel ?? (hasApiKey() ? anthropicCallModel : undefined);
  if (!callModel) {
    return { ...deterministicFallback(ctx), source: "fallback", model: "deterministic", generatedAt };
  }

  try {
    const raw = await callModel(ctx);
    const parsed = copilotResultSchema.parse(raw);
    parsed.qualification.score = clampScore(parsed.qualification.score);
    return { ...parsed, source: "ai", model: DEFAULT_MODEL, generatedAt };
  } catch (err) {
    // Resilience behaviour is unchanged (always fall back), but don't swallow the
    // reason: on the REAL model path a fallback could mean "no credits" OR a code
    // bug (rejected schema, null parsed_output). Log so the two are told apart.
    // Skip when the caller injected the model call (unit tests) to avoid noise.
    if (!injected) {
      logger.warn("copilot.model_fallback", {
        leadId: ctx.leadId,
        model: DEFAULT_MODEL,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
    return { ...deterministicFallback(ctx), source: "fallback", model: "deterministic", generatedAt };
  }
}

const SYSTEM_PROMPT = `You are a CRM sales copilot for a Thai B2B sales team. Given a lead's CRM context, produce a concise, evidence-grounded summary, a 0–100 qualification score with reasons, one next-best action, and a LINE draft when the context supports it. Rules:
- Base every claim on the provided context; never invent facts, budget, authority, or intent.
- Score only from available evidence; missing information lowers confidence, not the score.
- Never recommend WON or LOST from a score alone — prefer "no_change" unless the evidence clearly supports a stage.
- Draft a LINE reply only when there is a recent inbound LINE message, the contact is LINE-linked, and consent is not OPTED_OUT. Otherwise set lineReply to null.
- A LINE draft must answer the latest customer message first, be concise and chat-appropriate, and keep requiresApproval true.
- If the contact's consent is OPTED_OUT, do not recommend contacting them.
- Return output strictly matching the provided schema.`;

function renderContext(ctx: CopilotContext): string {
  return [
    `Lead: ${ctx.title}`,
    `Stage: ${ctx.stage} · Source: ${ctx.source} · Value(THB): ${ctx.valueTHB} · Existing score: ${ctx.score ?? "none"}`,
    `Company: ${ctx.company.name} (industry: ${ctx.company.industry ?? "?"}, size: ${ctx.company.size ?? "?"})`,
    `Contact: ${ctx.contact.name} (${ctx.contact.title ?? "?"}) · LINE: ${ctx.contact.hasLine ? "yes" : "no"} · consent: ${ctx.contact.consentStatus}`,
    `Owner: ${ctx.ownerName}`,
    `Days since last activity: ${ctx.daysSinceLastActivity ?? "no activity"}`,
    "",
    "Recent activities (newest first):",
    ...(ctx.activities.length ? ctx.activities.map((a) => `- [${a.type}] ${a.body} (${a.at})`) : ["- none"]),
    "",
    "Recent LINE messages (newest first):",
    ...(ctx.messages.length ? ctx.messages.map((m) => `- [${m.direction}] ${m.body} (${m.at})`) : ["- none"]),
  ].join("\n");
}

// The real model call. Imported lazily so the SDK never loads in the fallback-
// only path (no key / injected callModel), keeping that path dependency-free.
const anthropicCallModel: CallModel = async (ctx) => {
  const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("@anthropic-ai/sdk/helpers/zod"),
  ]);
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: renderContext(ctx) }],
    output_config: { format: zodOutputFormat(copilotResultSchema) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("copilot: model returned no parseable output");
  return parsed as CopilotResult;
};
