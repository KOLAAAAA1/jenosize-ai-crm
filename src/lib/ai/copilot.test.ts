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
    expect(r.nextAction?.action).toMatch(/ห้ามติดต่อ/);
    expect(r.nextAction?.priority).toBe("low");
  });

  it("writes its natural-language output in Thai", () => {
    const r = deterministicFallback(makeCtx());
    const thai = /[฀-๿]/; // Thai unicode block
    expect(r.summary.overview).toMatch(thai);
    expect(r.nextAction?.action).toMatch(thai);
    expect(r.qualification.reasons.every((x) => thai.test(x))).toBe(true);
    expect(r.warnings.every((x) => thai.test(x))).toBe(true);
  });
});

describe("deterministicFallback — stage plays", () => {
  const recent = { daysSinceLastActivity: 3 };
  it("gives a distinct next action for each of the five pipeline stages", () => {
    const actions = {
      NEW: deterministicFallback(makeCtx({ stage: "NEW", ...recent })).nextAction!.action,
      QUALIFIED: deterministicFallback(makeCtx({ stage: "QUALIFIED", ...recent })).nextAction!.action,
      PROPOSAL: deterministicFallback(makeCtx({ stage: "PROPOSAL", ...recent })).nextAction!.action,
      WON: deterministicFallback(makeCtx({ stage: "WON", ...recent })).nextAction!.action,
      LOST: deterministicFallback(makeCtx({ stage: "LOST", ...recent })).nextAction!.action,
    };
    expect(actions.NEW).toMatch(/คัดกรอง/);
    expect(actions.QUALIFIED).toMatch(/ส่งข้อเสนอ/);
    expect(actions.PROPOSAL).toMatch(/ติดตามข้อเสนอ/);
    expect(actions.WON).toMatch(/ส่งมอบ|ออนบอร์ด/);
    expect(actions.LOST).toMatch(/เสียโอกาส/);
    // all five must be different plays, not one generic action
    expect(new Set(Object.values(actions)).size).toBe(5);
  });

  it("escalates a still-open lead to high priority when it goes stale", () => {
    const r = deterministicFallback(makeCtx({ stage: "NEW", daysSinceLastActivity: 90 }));
    expect(r.nextAction?.priority).toBe("high");
    expect(r.nextAction?.reason).toMatch(/รีบติดตาม/);
  });
});

describe("deterministicFallback — repeat-customer signal", () => {
  const repeatHistory = { contactLeadCount: 3, companyLeadCount: 5, companyWonCount: 1 };

  it("flags a repeat customer and folds a cross-sell nudge into the next action", () => {
    const r = deterministicFallback(makeCtx({ history: repeatHistory }));
    expect(r.summary.keyFacts.some((f) => /ลูกค้าเก่า/.test(f))).toBe(true);
    expect(r.nextAction?.reason).toMatch(/ลูกค้าเก่า/);
  });

  it("applies the repeat-customer nudge across all stages, including WON", () => {
    const r = deterministicFallback(makeCtx({ stage: "WON", history: { contactLeadCount: 2, companyLeadCount: 2, companyWonCount: 1 } }));
    expect(r.nextAction?.reason).toMatch(/ลูกค้าเก่า/);
  });

  it("adds no repeat-customer signal for a single-lead or history-less contact", () => {
    const single = deterministicFallback(makeCtx({ history: { contactLeadCount: 1, companyLeadCount: 1, companyWonCount: 0 } }));
    expect(single.summary.keyFacts.some((f) => /ดีลแรก/.test(f))).toBe(true);
    expect(single.nextAction?.reason).not.toMatch(/ลูกค้าเก่า/);

    const none = deterministicFallback(makeCtx());
    expect(none.summary.keyFacts.some((f) => /ลูกค้าเก่า|ดีลแรก/.test(f))).toBe(false);
  });

  it("keeps the opt-out block above the repeat-customer nudge", () => {
    const r = deterministicFallback(makeCtx({
      contact: { name: "Nok", title: null, consentStatus: "OPTED_OUT", hasLine: true },
      history: repeatHistory,
    }));
    expect(r.nextAction?.action).toMatch(/ห้ามติดต่อ/);
    expect(r.nextAction?.reason).not.toMatch(/ลูกค้าเก่า/);
  });

  it("is deterministic with history present", () => {
    expect(deterministicFallback(makeCtx({ history: repeatHistory })))
      .toEqual(deterministicFallback(makeCtx({ history: repeatHistory })));
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
