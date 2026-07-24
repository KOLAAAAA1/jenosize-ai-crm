import type { Stage } from "@prisma/client";

export const STAGE_ORDER: Stage[] = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
export const ALL_DASHBOARD_FILTER = "ALL";

export type DashboardLead = Pick<{ stage: Stage; valueTHB: number; createdAt: Date | string }, "stage" | "valueTHB" | "createdAt">;

// Flat, serializable shape handed to the client charts. Deliberately carries no
// lead id: the reports aggregate and filter by owner/company/month/stage only, so
// omitting it trims the per-lead payload that ships in the RSC response.
export type DashboardReportLead = DashboardLead & {
  ownerId: string;
  ownerName: string;
  companyId: string;
  companyName: string;
};

export type DashboardSectionFilters = {
  ownerId: string;
  companyId: string;
  month: string;
  stage: string;
};

export type DashboardMetrics = {
  openPipelineValue: number;
  winRate: number | null;
  byStage: Array<{ stage: Stage; count: number; valueTHB: number }>;
  createdByMonth: Array<{ label: string; count: number }>;
  pipelineValueByMonth: Array<{ label: string } & Record<Stage, number>>;
};

export function sevenDaysAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function monthKey(date: Date | string): string {
  if (typeof date === "string") {
    const [year, month] = date.slice(0, 7).split("-");
    return `${year}-${Number(month) - 1}`;
  }
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

export function reportMonthKey(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 7);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Anchors the trailing-six-month window to a "YYYY-MM" filter value so the trend
// and monthly charts end on the selected month instead of the current one. Pure
// (no clock read), so it is safe to call during render.
export function monthAnchorDate(month: string): Date {
  const [year, rawMonth] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(rawMonth) - 1, 1));
}

export function filterDashboardLeads(
  leads: DashboardReportLead[],
  filters: DashboardSectionFilters,
): DashboardReportLead[] {
  return leads.filter((lead) => (
    (filters.ownerId === ALL_DASHBOARD_FILTER || lead.ownerId === filters.ownerId)
    && (filters.companyId === ALL_DASHBOARD_FILTER || lead.companyId === filters.companyId)
    && (filters.month === ALL_DASHBOARD_FILTER || reportMonthKey(lead.createdAt) === filters.month)
    && (filters.stage === ALL_DASHBOARD_FILTER || lead.stage === filters.stage)
  ));
}

// Keeps the dashboard's aggregation rules in one testable module. The route only
// supplies leads already restricted to the current user's permitted scope.
export function buildDashboardMetrics(leads: DashboardLead[], now: Date = new Date()): DashboardMetrics {
  const byStage = STAGE_ORDER.map((stage) => ({ stage, count: 0, valueTHB: 0 }));
  const byStageMap = new Map(byStage.map((summary) => [summary.stage, summary]));

  for (const lead of leads) {
    const summary = byStageMap.get(lead.stage);
    if (summary) {
      summary.count += 1;
      summary.valueTHB += lead.valueTHB;
    }
  }

  const closedLeads = (byStageMap.get("WON")?.count ?? 0) + (byStageMap.get("LOST")?.count ?? 0);
  const wonLeads = byStageMap.get("WON")?.count ?? 0;
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
      count: 0,
      NEW: 0,
      QUALIFIED: 0,
      PROPOSAL: 0,
      WON: 0,
      LOST: 0,
    };
  });
  const monthsByKey = new Map(months.map((month) => [month.key, month]));

  for (const lead of leads) {
    const month = monthsByKey.get(monthKey(lead.createdAt));
    if (month) {
      month.count += 1;
      month[lead.stage] += lead.valueTHB;
    }
  }

  return {
    openPipelineValue: byStage
      .filter(({ stage }) => stage !== "WON" && stage !== "LOST")
      .reduce((total, { valueTHB }) => total + valueTHB, 0),
    winRate: closedLeads === 0 ? null : Math.round((wonLeads / closedLeads) * 100),
    byStage,
    createdByMonth: months.map(({ label, count }) => ({ label, count })),
    pipelineValueByMonth: months.map((month) => ({
      label: month.label,
      NEW: month.NEW,
      QUALIFIED: month.QUALIFIED,
      PROPOSAL: month.PROPOSAL,
      WON: month.WON,
      LOST: month.LOST,
    })),
  };
}
