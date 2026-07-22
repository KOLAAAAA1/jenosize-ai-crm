import { describe, it, expect, vi } from "vitest";
import { autoReplyToWebhook, isGreeting, GREETING_REPLY_TEXT } from "./autoreply";
import type { LineSendResult } from "./adapter";

const okReply = async (): Promise<LineSendResult> => ({
  ok: true,
  providerMessageId: "mock:reply:x",
  mode: "mock",
  requestId: null,
});

const enabled = async () => true;
const disabled = async () => false;

function body(events: unknown[]): string {
  return JSON.stringify({ destination: "U-oa", events });
}

const followEvent = { type: "follow", replyToken: "rt-follow", source: { type: "user", userId: "U1" } };
const greetingMsg = {
  type: "message",
  webhookEventId: "e1",
  replyToken: "rt-msg",
  source: { type: "user", userId: "U1" },
  message: { type: "text", id: "m1", text: "สวัสดีครับ" },
};
const nonGreetingMsg = { ...greetingMsg, webhookEventId: "e2", replyToken: "rt-msg2", message: { type: "text", id: "m2", text: "ราคาเท่าไหร่" } };

describe("isGreeting", () => {
  it("matches Thai and English greetings, case-insensitive", () => {
    expect(isGreeting("สวัสดีครับ")).toBe(true);
    expect(isGreeting("  Hello there")).toBe(true);
    expect(isGreeting("HI")).toBe(true);
    expect(isGreeting("ราคาเท่าไหร่")).toBe(false);
    expect(isGreeting("อยากได้ใบเสนอราคา")).toBe(false);
  });
});

describe("autoReplyToWebhook (per-contact gate)", () => {
  it("replies to a follow event when the contact toggle is ON", async () => {
    const reply = vi.fn(okReply);
    const res = await autoReplyToWebhook(body([followEvent]), { isEnabledForUser: enabled, reply });
    expect(res).toEqual({ replied: 1, failed: 0 });
    expect(reply).toHaveBeenCalledWith({ replyToken: "rt-follow", text: GREETING_REPLY_TEXT });
  });

  it("replies to a greeting message when the contact toggle is ON", async () => {
    const reply = vi.fn(okReply);
    const res = await autoReplyToWebhook(body([greetingMsg]), { isEnabledForUser: enabled, reply });
    expect(res).toEqual({ replied: 1, failed: 0 });
    expect(reply).toHaveBeenCalledWith({ replyToken: "rt-msg", text: GREETING_REPLY_TEXT });
  });

  it("does NOT reply when the contact toggle is OFF (the default)", async () => {
    const reply = vi.fn(okReply);
    const res = await autoReplyToWebhook(body([followEvent, greetingMsg]), { isEnabledForUser: disabled, reply });
    expect(res).toEqual({ replied: 0, failed: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it("checks the toggle against the event's LINE userId", async () => {
    const reply = vi.fn(okReply);
    const isEnabledForUser = vi.fn(enabled);
    await autoReplyToWebhook(body([greetingMsg]), { isEnabledForUser, reply });
    expect(isEnabledForUser).toHaveBeenCalledWith("U1");
  });

  it("does NOT reply to a non-greeting message even when toggle is ON", async () => {
    const reply = vi.fn(okReply);
    const isEnabledForUser = vi.fn(enabled);
    const res = await autoReplyToWebhook(body([nonGreetingMsg]), { isEnabledForUser, reply });
    expect(res).toEqual({ replied: 0, failed: 0 });
    expect(reply).not.toHaveBeenCalled();
    // Non-greeting is filtered before the toggle lookup — no wasted DB hit.
    expect(isEnabledForUser).not.toHaveBeenCalled();
  });

  it("never throws on invalid JSON", async () => {
    const reply = vi.fn(okReply);
    const res = await autoReplyToWebhook("not json", { isEnabledForUser: enabled, reply });
    expect(res).toEqual({ replied: 0, failed: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it("counts a failure and never throws when the reply adapter throws (expired token, etc.)", async () => {
    const reply = vi.fn(async () => {
      throw new Error("Invalid reply token");
    });
    const res = await autoReplyToWebhook(body([greetingMsg]), { isEnabledForUser: enabled, reply });
    expect(res).toEqual({ replied: 0, failed: 1 });
  });

  it("skips the event (no throw) when the toggle lookup itself fails", async () => {
    const reply = vi.fn(okReply);
    const isEnabledForUser = async () => {
      throw new Error("db down");
    };
    const res = await autoReplyToWebhook(body([greetingMsg]), { isEnabledForUser, reply });
    expect(res).toEqual({ replied: 0, failed: 0 });
    expect(reply).not.toHaveBeenCalled();
  });
});
