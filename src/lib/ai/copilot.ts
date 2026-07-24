import type { CopilotContext } from "./context";
import { copilotResultSchema, clampScore, type CopilotResult, type CopilotSuggestion } from "./schema";
import { deterministicFallback } from "./fallback";
import { logger } from "@/lib/logger";

// The single seam that makes this testable without a network or a DB: the model
// call is an injected dependency. Tests pass a `callModel` that throws and assert
// the result falls back deterministically. Production passes nothing and the real
// Anthropic client is used — but only when a key is actually configured.
export type CallModel = (ctx: CopilotContext) => Promise<CopilotResult>;

// The AI engine is provider-agnostic behind the CallModel seam. OpenRouter
// (OpenAI-compatible) is the active engine when OPENROUTER_API_KEY is set;
// Anthropic is a drop-in alternative when only ANTHROPIC_API_KEY is set.
// `CRM_AI_MODEL` overrides the model id for whichever provider is active.
type Provider = "openrouter" | "anthropic";

// OpenRouter default is a $0 model; override with CRM_AI_MODEL. Note free tiers are
// rate-limited and can be retired without notice (a fallback then logs the error) —
// swap CRM_AI_MODEL to a paid slug (e.g. openai/gpt-oss-120b) for stability.
const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: "google/gemma-4-26b-a4b-it:free",
  anthropic: "claude-opus-4-8",
};

function activeProvider(): Provider | null {
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return null;
}

function modelFor(provider: Provider): string {
  return process.env.CRM_AI_MODEL?.trim() || DEFAULT_MODELS[provider];
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
  const provider = injected ? null : activeProvider();
  const callModel =
    opts.callModel ??
    (provider === "openrouter" ? openRouterCallModel : provider === "anthropic" ? anthropicCallModel : undefined);
  if (!callModel) {
    return { ...deterministicFallback(ctx), source: "fallback", model: "deterministic", generatedAt };
  }
  const model = injected ? "injected" : modelFor(provider!);

  try {
    const raw = await callModel(ctx);
    const parsed = copilotResultSchema.parse(raw);
    parsed.qualification.score = clampScore(parsed.qualification.score);
    return { ...parsed, source: "ai", model, generatedAt };
  } catch (err) {
    // Resilience behaviour is unchanged (always fall back), but don't swallow the
    // reason: on the REAL model path a fallback could mean "no credits" OR a code
    // bug (rejected schema, null parsed_output). Log so the two are told apart.
    // Skip when the caller injected the model call (unit tests) to avoid noise.
    if (!injected) {
      logger.warn("copilot.model_fallback", {
        leadId: ctx.leadId,
        provider,
        model,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
    return { ...deterministicFallback(ctx), source: "fallback", model: "deterministic", generatedAt };
  }
}

const SYSTEM_PROMPT = `You are a CRM sales copilot for a Thai B2B sales team. Given a lead's CRM context, produce a concise, evidence-grounded summary, a 0–100 qualification score with reasons, one next-best action, and a LINE draft when the context supports it. Rules:
- Write ALL natural-language output in Thai (ภาษาไทย): summary.overview, keyFacts, openQuestions, qualification.reasons, nextAction.action, nextAction.reason, lineReply.draft, and warnings. Keep enum values (status, recommendedStage, confidence, priority) and numbers exactly as the schema defines — do not translate or localize them.
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
    ...(ctx.history
      ? [`Relationship history (this user's scope): ${ctx.history.contactLeadCount} lead(s) for this contact, ${ctx.history.companyLeadCount} for this company (${ctx.history.companyWonCount} won)`]
      : []),
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
    model: modelFor("anthropic"),
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: renderContext(ctx) }],
    output_config: { format: zodOutputFormat(copilotResultSchema) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("copilot: model returned no parseable output");
  return parsed as CopilotResult;
};

// OpenAI-compatible models can't take a Zod output_config, so the exact JSON shape
// is described here and enforced by copilotResultSchema.parse() in generateSuggestion.
const JSON_SHAPE_HINT = `Return ONLY a JSON object — no prose, no markdown code fences — with EXACTLY this shape:
{
  "status": "success" | "insufficient_context" | "service_unavailable",
  "summary": { "overview": string, "keyFacts": string[], "openQuestions": string[] },
  "qualification": { "score": number | null, "confidence": "low" | "medium" | "high", "reasons": string[], "recommendedStage": "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST" | "no_change" },
  "nextAction": { "action": string, "reason": string, "priority": "low" | "medium" | "high" } | null,
  "lineReply": { "draft": string | null, "requiresApproval": true } | null,
  "warnings": string[]
}`;

// OpenRouter — OpenAI-compatible Chat Completions. Uses fetch (no SDK) so the
// fallback-only path stays dependency-free. JSON mode + prompt-described shape,
// then validated by copilotResultSchema in generateSuggestion (invalid → fallback).
const openRouterCallModel: CallModel = async (ctx) => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
      "Content-Type": "application/json",
      // Optional attribution shown on the OpenRouter dashboard.
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "Jenosize AI CRM",
    },
    body: JSON.stringify({
      model: modelFor("openrouter"),
      max_tokens: 2048,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_SHAPE_HINT}` },
        { role: "user", content: renderContext(ctx) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter: no message content in response");
  return extractJson(content) as CopilotResult;
};

// Some models wrap JSON in prose/fences despite JSON mode; recover the object
// rather than failing the whole run.
function extractJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("OpenRouter: response was not valid JSON");
  }
}
