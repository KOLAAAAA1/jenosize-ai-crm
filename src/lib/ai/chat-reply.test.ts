import { describe, it, expect, vi } from "vitest";
import { generateChatReply, sanitizeReply, FALLBACK_REPLY_TEXT, type ChatReplyContext } from "./chat-reply";

const ctx: ChatReplyContext = {
  contactName: "สมชาย ใจดี",
  companyName: "ACME",
  lead: { title: "CRM project", stage: "QUALIFIED" },
  latestInbound: "ราคาเท่าไหร่ครับ",
  history: [{ direction: "IN", body: "ราคาเท่าไหร่ครับ", at: "2026-07-30T03:00:00.000Z" }],
};

describe("generateChatReply (injected callModel seam)", () => {
  it("returns the model's text as an 'ai' reply", async () => {
    const callModel = vi.fn(async () => "ขอบคุณครับ เดี๋ยวทีมขายส่งรายละเอียดให้ครับ");
    const res = await generateChatReply(ctx, { callModel });
    expect(res).toEqual({ text: "ขอบคุณครับ เดี๋ยวทีมขายส่งรายละเอียดให้ครับ", source: "ai", model: "injected" });
    expect(callModel).toHaveBeenCalledWith(ctx);
  });

  it("falls back deterministically when the model throws (no credits, timeout, bad JSON)", async () => {
    const res = await generateChatReply(ctx, {
      callModel: async () => {
        throw new Error("OpenRouter 429: rate limited");
      },
    });
    expect(res).toEqual({ text: FALLBACK_REPLY_TEXT, source: "fallback", model: "deterministic" });
  });

  it("falls back when the model returns an empty reply — the customer is never left on read", async () => {
    const res = await generateChatReply(ctx, { callModel: async () => "   \n  " });
    expect(res.source).toBe("fallback");
    expect(res.text).toBe(FALLBACK_REPLY_TEXT);
  });

  it("falls back when no provider key is configured (nothing to call)", async () => {
    const prevOpenRouter = process.env.OPENROUTER_API_KEY;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await generateChatReply(ctx);
      expect(res).toEqual({ text: FALLBACK_REPLY_TEXT, source: "fallback", model: "deterministic" });
    } finally {
      if (prevOpenRouter != null) process.env.OPENROUTER_API_KEY = prevOpenRouter;
      if (prevAnthropic != null) process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }
  });
});

describe("sanitizeReply", () => {
  it("unwraps a quoted reply", () => {
    expect(sanitizeReply('"สวัสดีครับ"')).toBe("สวัสดีครับ");
  });

  it("collapses runaway blank lines", () => {
    expect(sanitizeReply("บรรทัดหนึ่ง\n\n\n\nบรรทัดสอง")).toBe("บรรทัดหนึ่ง\n\nบรรทัดสอง");
  });

  it("truncates an over-long reply instead of dropping it", () => {
    const long = "ก".repeat(2000);
    const out = sanitizeReply(long);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.endsWith("…")).toBe(true);
  });
});
