import { describe, expect, it } from "vitest";
import { buildDashboardMetrics, filterDashboardLeads, monthAnchorDate, sevenDaysAgo } from "@/lib/dashboard-metrics";

describe("sevenDaysAgo", () => {
  it("returns the exact seven-day activity cutoff", () => {
    expect(sevenDaysAgo(new Date("2026-07-24T12:00:00Z")).toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });
});

describe("buildDashboardMetrics", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("summarizes the open pipeline, closed-lead win rate, and trailing six months", () => {
    const metrics = buildDashboardMetrics([
      { stage: "NEW", valueTHB: 100_000, createdAt: new Date("2026-02-01T00:00:00Z") },
      { stage: "QUALIFIED", valueTHB: 200_000, createdAt: new Date("2026-03-15T00:00:00Z") },
      { stage: "PROPOSAL", valueTHB: 300_000, createdAt: new Date("2026-04-30T00:00:00Z") },
      { stage: "WON", valueTHB: 400_000, createdAt: new Date("2026-07-01T00:00:00Z") },
      { stage: "LOST", valueTHB: 500_000, createdAt: new Date("2026-07-02T00:00:00Z") },
      { stage: "NEW", valueTHB: 999_000, createdAt: new Date("2026-01-31T23:59:59Z") },
    ], now);

    expect(metrics.openPipelineValue).toBe(1_599_000);
    expect(metrics.winRate).toBe(50);
    expect(metrics.byStage).toEqual([
      { stage: "NEW", count: 2, valueTHB: 1_099_000 },
      { stage: "QUALIFIED", count: 1, valueTHB: 200_000 },
      { stage: "PROPOSAL", count: 1, valueTHB: 300_000 },
      { stage: "WON", count: 1, valueTHB: 400_000 },
      { stage: "LOST", count: 1, valueTHB: 500_000 },
    ]);
    expect(metrics.createdByMonth).toEqual([
      { label: "Feb", count: 1 },
      { label: "Mar", count: 1 },
      { label: "Apr", count: 1 },
      { label: "May", count: 0 },
      { label: "Jun", count: 0 },
      { label: "Jul", count: 2 },
    ]);
    expect(metrics.pipelineValueByMonth).toEqual([
      { label: "Feb", NEW: 100_000, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 },
      { label: "Mar", NEW: 0, QUALIFIED: 200_000, PROPOSAL: 0, WON: 0, LOST: 0 },
      { label: "Apr", NEW: 0, QUALIFIED: 0, PROPOSAL: 300_000, WON: 0, LOST: 0 },
      { label: "May", NEW: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 },
      { label: "Jun", NEW: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 },
      { label: "Jul", NEW: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 400_000, LOST: 500_000 },
    ]);
  });

  it("anchors the six-month window to a selected month outside the default range", () => {
    const januaryLead = { stage: "NEW" as const, valueTHB: 100_000, createdAt: "2026-01-15T00:00:00.000Z" };

    // Default window (relative to July) excludes January, so the trend is empty.
    expect(buildDashboardMetrics([januaryLead], now).createdByMonth).toEqual([
      { label: "Feb", count: 0 },
      { label: "Mar", count: 0 },
      { label: "Apr", count: 0 },
      { label: "May", count: 0 },
      { label: "Jun", count: 0 },
      { label: "Jul", count: 0 },
    ]);

    // Anchoring the window to the selected month surfaces the lead at the right edge.
    const anchored = buildDashboardMetrics([januaryLead], monthAnchorDate("2026-01"));
    expect(anchored.createdByMonth).toEqual([
      { label: "Aug", count: 0 },
      { label: "Sep", count: 0 },
      { label: "Oct", count: 0 },
      { label: "Nov", count: 0 },
      { label: "Dec", count: 0 },
      { label: "Jan", count: 1 },
    ]);
    expect(anchored.pipelineValueByMonth.at(-1)).toEqual({ label: "Jan", NEW: 100_000, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 });
  });

  it("reports an unavailable win rate until at least one lead is closed", () => {
    const metrics = buildDashboardMetrics([
      { stage: "NEW", valueTHB: 100_000, createdAt: new Date("2026-07-01T00:00:00Z") },
    ], now);

    expect(metrics.winRate).toBeNull();
  });

  it("keeps each report's owner, month, company, and stage filters independent and precise", () => {
    const leads = [
      { ownerId: "owner-a", ownerName: "A", companyId: "company-a", companyName: "A Co", stage: "NEW" as const, valueTHB: 100, createdAt: "2026-06-12T00:00:00.000Z" },
      { ownerId: "owner-b", ownerName: "B", companyId: "company-b", companyName: "B Co", stage: "PROPOSAL" as const, valueTHB: 200, createdAt: "2026-06-19T00:00:00.000Z" },
      { ownerId: "owner-a", ownerName: "A", companyId: "company-a", companyName: "A Co", stage: "WON" as const, valueTHB: 300, createdAt: "2026-07-01T00:00:00.000Z" },
    ];

    expect(filterDashboardLeads(leads, {
      ownerId: "owner-a",
      companyId: "company-a",
      month: "2026-06",
      stage: "NEW",
    }).map((lead) => lead.valueTHB)).toEqual([100]);
  });
});
