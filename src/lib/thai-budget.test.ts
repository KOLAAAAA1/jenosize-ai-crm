import { describe, it, expect } from "vitest";
import { parseThaiBudget } from "./thai-budget";

describe("parseThaiBudget", () => {
  it("parses Thai magnitude words (with/without บาท, decimals)", () => {
    expect(parseThaiBudget("1 ล้านบาท")).toBe(1_000_000);
    expect(parseThaiBudget("1ล้าน")).toBe(1_000_000);
    expect(parseThaiBudget("1.5 ล้าน")).toBe(1_500_000);
    expect(parseThaiBudget("5 แสน")).toBe(500_000);
    expect(parseThaiBudget("3 หมื่นบาท")).toBe(30_000);
    expect(parseThaiBudget("2พัน")).toBe(2_000);
    expect(parseThaiBudget("5 ร้อย")).toBe(500);
  });

  it("parses plain digits and k/m shorthand, ignoring separators", () => {
    expect(parseThaiBudget("1000000")).toBe(1_000_000);
    expect(parseThaiBudget("1,000,000 บาท")).toBe(1_000_000);
    expect(parseThaiBudget("500k")).toBe(500_000);
    expect(parseThaiBudget("1.5M")).toBe(1_500_000);
    expect(parseThaiBudget("0")).toBe(0);
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseThaiBudget("")).toBeNull();
    expect(parseThaiBudget("   ")).toBeNull();
    expect(parseThaiBudget("ล้าน")).toBeNull(); // magnitude with no number
    expect(parseThaiBudget("สอบถามราคา")).toBeNull();
    expect(parseThaiBudget("-5")).toBeNull();
  });
});
