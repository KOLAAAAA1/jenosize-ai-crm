import { describe, it, expect } from "vitest";
import { formatTHB, formatDate, timeAgo } from "@/lib/format";

describe("formatTHB", () => {
  it("formats whole THB with grouping and no decimals", () => {
    expect(formatTHB(1_500_000)).toMatch(/1,500,000/);
    expect(formatTHB(1_500_000)).not.toMatch(/\.\d/);
  });
  it("handles zero", () => {
    expect(formatTHB(0)).toMatch(/0/);
  });
});

describe("formatDate", () => {
  it("renders the year", () => {
    expect(formatDate(new Date("2026-07-19T00:00:00Z"))).toMatch(/2026/);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-07-19T00:00:00Z");
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now);

  it("seconds", () => expect(ago(30_000)).toBe("30s ago"));
  it("minutes", () => expect(ago(5 * 60_000)).toBe("5m ago"));
  it("hours", () => expect(ago(3 * 3_600_000)).toBe("3h ago"));
  it("days", () => expect(ago(2 * 86_400_000)).toBe("2d ago"));
  it("months", () => expect(ago(60 * 86_400_000)).toBe("2mo ago"));
  it("clamps future timestamps to 0s", () => expect(ago(-10_000)).toBe("0s ago"));
});
