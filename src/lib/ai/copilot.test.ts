import { describe, it, expect } from "vitest";
import { generateSuggestion, type CallModel } from "./copilot";
import { deterministicFallback } from "./fallback";
import { buildCopilotContext, type CopilotContext } from "./context";
import { copilotResultSchema, type CopilotResult } from "./schema";

function makeCtx(overrides: Partial<CopilotContext> = {}): CopilotContext {
  return {
    leadId: "led_test",
    title: "Test Lead",
    stage: "PROPOSAL",
    source: "LINE_OA",
    valueTHB: 500_000,
    score: null,
    company: { name: "Acme", industry: "Technology", size: "51-200" },
    contact: { name: "Somchai", title: "CTO", consentStatus: "UNKNOWN", hasLine: true },
    ownerName: "Owner",
    activities: [],
    messages: [],
    daysSinceLastActivity: 3,
    now: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("deterministicFallback", () => {
  it("produces a schema-valid, service_unavailable result", () => {
    const r = deterministicFallback(makeCtx());
    expect(copilotResultSchema.safeParse(r).success).toBe(true);
    expect(r.status).toBe("service_unavailable");
    expect(r.lineReply).toBeNull(); // never a fabricated draft
    expect(r.qualification.recommendedStage).toBe("no_change"); // never a score-driven stage move
  });

  it("scores from stage + recency + source and clamps to 0–100", () => {
    // PROPOSAL(70) + recent<=7d(+10) + LINE_OA(+5) = 85
    expect(deterministicFallback(makeCtx()).qualification.score).toBe(85);
    // WON(95) + recent(+10) + LINE_OA(+5) = 110 → clamped to 100
    expect(deterministicFallback(makeCtx({ stage: "WON" })).qualification.score).toBe(100);
    // LOST(10) + stale(-5) + MANUAL(0) = 5
    expect(
      deterministicFallback(makeCtx({ stage: "LOST", source: "MANUAL", daysSinceLastActivity: 90 }))
        .qualification.score,
    ).toBe(5);
  });

  it("is deterministic — identical input yields identical output", () => {
    expect(deterministicFallback(makeCtx())).toEqual(deterministicFallback(makeCtx()));
  });

  it("blocks outreach when the contact has opted out", () => {
    const r = deterministicFallback(makeCtx({ contact: { name: "Nok", title: null, consentStatus: "OPTED_OUT", hasLine: true } }));
    expect(r.nextAction?.action).toMatch(/Do not contact/i);
    expect(r.nextAction?.priority).toBe("low");
  });
});

describe("generateSuggestion (injected callModel seam)", () => {
  it("falls back deterministically when the model call throws", async () => {
    const throwing: CallModel = async () => {
      throw new Error("model unavailable");
    };
    const s = await generateSuggestion(makeCtx(), { callModel: throwing });
    expect(s.source).toBe("fallback");
    expect(s.model).toBe("deterministic");
    expect(copilotResultSchema.safeParse(s).success).toBe(true);
  });

  it("returns an AI-sourced result when the model call succeeds and validates", async () => {
    const good: CopilotResult = {
      status: "success",
      summary: { overview: "ok", keyFacts: ["a"], openQuestions: [] },
      qualification: { score: 150, confidence: "high", reasons: ["strong fit"], recommendedStage: "QUALIFIED" },
      nextAction: { action: "Call", reason: "warm", priority: "high" },
      lineReply: null,
      warnings: [],
    };
    const s = await generateSuggestion(makeCtx(), { callModel: async () => good });
    expect(s.source).toBe("ai");
    expect(s.qualification.score).toBe(100); // clamped from 150
  });

  it("falls back when the model returns schema-invalid output", async () => {
    const bad = { status: "success" } as unknown as CopilotResult; // missing required fields
    const s = await generateSuggestion(makeCtx(), { callModel: async () => bad });
    expect(s.source).toBe("fallback");
  });
});

describe("buildCopilotContext", () => {
  it("derives daysSinceLastActivity from the newest activity/message", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    const lead = {
      id: "l", title: "t", stage: "NEW" as const, source: "WEBSITE" as const, valueTHB: 0, score: null,
      company: { name: "C", industry: null, size: null },
      contact: { firstName: "P", lastName: "Q", title: null, consentStatus: "UNKNOWN", lineUserId: null },
      owner: { name: "O" },
      activities: [{ type: "NOTE" as const, body: "x", createdAt: new Date("2026-07-10T00:00:00.000Z") }],
      messages: [],
    };
    expect(buildCopilotContext(lead, now).daysSinceLastActivity).toBe(10);
  });

  it("returns null daysSinceLastActivity when there is no history", () => {
    const lead = {
      id: "l", title: "t", stage: "NEW" as const, source: "WEBSITE" as const, valueTHB: 0, score: null,
      company: { name: "C", industry: null, size: null },
      contact: { firstName: "P", lastName: "Q", title: null, consentStatus: "UNKNOWN", lineUserId: null },
      owner: { name: "O" }, activities: [], messages: [],
    };
    expect(buildCopilotContext(lead).daysSinceLastActivity).toBeNull();
  });
});
