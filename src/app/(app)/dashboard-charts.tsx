"use client";

import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Stage } from "@prisma/client";
import { formatTHB } from "@/lib/format";
import {
  ALL_DASHBOARD_FILTER,
  buildDashboardMetrics,
  filterDashboardLeads,
  monthAnchorDate,
  reportMonthKey,
  STAGE_ORDER,
  type DashboardReportLead,
  type DashboardSectionFilters,
} from "@/lib/dashboard-metrics";

const STAGE_COLORS: Record<Stage, { hex: string; dot: string }> = {
  NEW: { hex: "#0ea5e9", dot: "bg-sky-500" },
  QUALIFIED: { hex: "#8b5cf6", dot: "bg-violet-500" },
  PROPOSAL: { hex: "#f59e0b", dot: "bg-amber-500" },
  WON: { hex: "#10b981", dot: "bg-emerald-500" },
  LOST: { hex: "#f43f5e", dot: "bg-rose-500" },
};

const EMPTY_FILTERS: DashboardSectionFilters = {
  ownerId: ALL_DASHBOARD_FILTER,
  companyId: ALL_DASHBOARD_FILTER,
  month: ALL_DASHBOARD_FILTER,
  stage: ALL_DASHBOARD_FILTER,
};

const tooltipStyle = {
  border: "1px solid var(--color-zinc-200, #e4e4e7)",
  borderRadius: "0.5rem",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
  fontSize: "0.75rem",
};

function formatMonth(month: string): string {
  const [year, rawMonth] = month.split("-");
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${labels[Number(rawMonth) - 1]} ${year}`;
}

function useSectionReport(leads: DashboardReportLead[]) {
  const [filters, setFilters] = useState<DashboardSectionFilters>(EMPTY_FILTERS);
  const filteredLeads = useMemo(() => filterDashboardLeads(leads, filters), [leads, filters]);
  // When a month is selected it may fall outside the default trailing-six-month
  // window (relative to today), which would blank the trend/monthly charts. Anchor
  // the window to the selected month so those charts stay in sync with the filter.
  const metrics = useMemo(
    () =>
      filters.month === ALL_DASHBOARD_FILTER
        ? buildDashboardMetrics(filteredLeads)
        : buildDashboardMetrics(filteredLeads, monthAnchorDate(filters.month)),
    [filteredLeads, filters.month],
  );
  const owners = useMemo(() => Array.from(
    new Map(leads.map((lead) => [lead.ownerId, lead.ownerName])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [leads]);
  const companies = useMemo(() => Array.from(
    new Map(leads.map((lead) => [lead.companyId, lead.companyName])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [leads]);
  const months = useMemo(() => Array.from(new Set(leads.map((lead) => reportMonthKey(lead.createdAt)))).sort().reverse(), [leads]);

  return { companies, filters, metrics, months, owners, setFilters };
}

function SectionFilters({
  companies,
  filters,
  months,
  owners,
  onChange,
}: {
  companies: Array<{ id: string; name: string }>;
  filters: DashboardSectionFilters;
  months: string[];
  owners: Array<{ id: string; name: string }>;
  onChange: (filters: DashboardSectionFilters) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const update = (key: keyof DashboardSectionFilters, value: string) => onChange({ ...filters, [key]: value });
  const activeFilters = [
    filters.ownerId !== ALL_DASHBOARD_FILTER && { key: "ownerId" as const, label: `Person: ${owners.find((owner) => owner.id === filters.ownerId)?.name ?? "Selected"}` },
    filters.month !== ALL_DASHBOARD_FILTER && { key: "month" as const, label: `Month: ${formatMonth(filters.month)}` },
    filters.companyId !== ALL_DASHBOARD_FILTER && { key: "companyId" as const, label: `Company: ${companies.find((company) => company.id === filters.companyId)?.name ?? "Selected"}` },
    filters.stage !== ALL_DASHBOARD_FILTER && { key: "stage" as const, label: `Stage: ${filters.stage}` },
  ].filter((filter): filter is { key: keyof DashboardSectionFilters; label: string } => Boolean(filter));
  const selectClassName = "w-full rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

  return (
    <>
      <div className="flex flex-wrap items-center justify-self-end gap-2">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current" strokeWidth="1.6">
            <path d="M2.5 3.5h11M4.5 8h7M6.5 12.5h3" strokeLinecap="round" />
          </svg>
          Filters
          {activeFilters.length > 0 && <span className="grid size-5 place-items-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{activeFilters.length}</span>}
        </button>
        {activeFilters.length > 0 && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="min-h-9 px-1 text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">
            Reset
          </button>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="col-span-full mt-2 flex flex-wrap gap-1.5" aria-label="Active filters">
          {activeFilters.map((filter) => (
            <button key={filter.key} type="button" onClick={() => update(filter.key, ALL_DASHBOARD_FILTER)} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900">
              {filter.label}
              <span aria-hidden="true" className="text-sm leading-none">×</span>
              <span className="sr-only">Remove {filter.label}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && (
        <div id={panelId} className="col-span-full mt-3 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950/50">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <span className="mb-1.5 block">Person</span>
            <select value={filters.ownerId} onChange={(event) => update("ownerId", event.target.value)} className={selectClassName}>
              <option value={ALL_DASHBOARD_FILTER}>All people</option>
              {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <span className="mb-1.5 block">Month</span>
            <select value={filters.month} onChange={(event) => update("month", event.target.value)} className={selectClassName}>
              <option value={ALL_DASHBOARD_FILTER}>All months</option>
              {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <span className="mb-1.5 block">Company</span>
            <select value={filters.companyId} onChange={(event) => update("companyId", event.target.value)} className={selectClassName}>
              <option value={ALL_DASHBOARD_FILTER}>All companies</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <span className="mb-1.5 block">Pipeline stage</span>
            <select value={filters.stage} onChange={(event) => update("stage", event.target.value)} className={selectClassName}>
              <option value={ALL_DASHBOARD_FILTER}>All stages</option>
              {STAGE_ORDER.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </label>
        </div>
      )}
    </>
  );
}

function ChartCard({ title, detail, filters, children }: { title: string; detail: string; filters: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
        </div>
        {filters}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function LeadTrendChart({ leads }: { leads: DashboardReportLead[] }) {
  const report = useSectionReport(leads);

  return (
    <ChartCard title="Lead creation trend" detail="New leads created over the last six months" filters={<SectionFilters {...report} onChange={report.setFilters} />}>
      <div className="h-52" role="img" aria-label="Line chart of new leads created over the last six months">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={report.metrics.createdByMonth} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} className="fill-zinc-500 text-xs dark:fill-zinc-400" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} className="fill-zinc-500 text-xs dark:fill-zinc-400" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${Number(value).toLocaleString()} leads`, "จำนวน"]} />
            <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", strokeWidth: 2, stroke: "var(--background)" }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {report.metrics.createdByMonth.reduce((total, month) => total + month.count, 0).toLocaleString()} leads created
      </p>
    </ChartCard>
  );
}

function PipelineValueChart({ leads }: { leads: DashboardReportLead[] }) {
  const report = useSectionReport(leads);

  return (
    <ChartCard title="Pipeline value by stage" detail="Open, won, and lost value across the current view" filters={<SectionFilters {...report} onChange={report.setFilters} />}>
      <div className="h-56" role="img" aria-label="Bar chart of pipeline value by stage">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report.metrics.byStage} layout="vertical" margin={{ top: 0, right: 12, left: -10, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => formatTHB(Number(value))} className="fill-zinc-500 text-xs dark:fill-zinc-400" />
            <YAxis type="category" dataKey="stage" width={72} tickLine={false} axisLine={false} className="fill-zinc-600 text-xs font-medium dark:fill-zinc-300" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatTHB(Number(value)), "จำนวนเงิน"]} />
            <Bar dataKey="valueTHB" radius={[0, 4, 4, 0]}>
              {report.metrics.byStage.map((summary) => <Cell key={summary.stage} fill={STAGE_COLORS[summary.stage].hex} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function MonthlyPipelineValueChart({ leads }: { leads: DashboardReportLead[] }) {
  const report = useSectionReport(leads);

  return (
    <ChartCard title="Monthly pipeline value by stage" detail="Horizontal bars compare each creation month, split by current pipeline stage" filters={<SectionFilters {...report} onChange={report.setFilters} />}>
      <div className="h-64" role="img" aria-label="Horizontal stacked bar chart comparing each month by pipeline stage value">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report.metrics.pipelineValueByMonth} layout="vertical" margin={{ top: 0, right: 12, left: -10, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => formatTHB(Number(value))} className="fill-zinc-500 text-xs dark:fill-zinc-400" />
            <YAxis type="category" dataKey="label" width={44} tickLine={false} axisLine={false} className="fill-zinc-600 text-xs font-medium dark:fill-zinc-300" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatTHB(Number(value)), "จำนวนเงิน"]} />
            {STAGE_ORDER.map((stage) => <Bar key={stage} dataKey={stage} stackId="pipeline" fill={STAGE_COLORS[stage].hex} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {STAGE_ORDER.map((stage) => (
          <li key={stage} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STAGE_COLORS[stage].dot}`} />
            {stage}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

function StageDistributionChart({ leads }: { leads: DashboardReportLead[] }) {
  const report = useSectionReport(leads);
  const total = report.metrics.byStage.reduce((sum, summary) => sum + summary.count, 0);

  return (
    <ChartCard title="Lead distribution" detail="How the current lead view is distributed by stage" filters={<SectionFilters {...report} onChange={report.setFilters} />}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="relative size-40 shrink-0" role="img" aria-label={`Pie chart showing ${total.toLocaleString()} leads by stage`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={report.metrics.byStage} dataKey="count" nameKey="stage" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
                {report.metrics.byStage.map((summary) => <Cell key={summary.stage} fill={STAGE_COLORS[summary.stage].hex} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${Number(value).toLocaleString()} leads`, "จำนวน"]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{total.toLocaleString()}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">leads</p>
            </div>
          </div>
        </div>
        <ul className="w-full space-y-2.5">
          {report.metrics.byStage.map((summary) => (
            <li key={summary.stage} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
                <span className={`size-2.5 rounded-full ${STAGE_COLORS[summary.stage].dot}`} />
                {summary.stage}
              </span>
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                {summary.count.toLocaleString()} · {total === 0 ? 0 : Math.round((summary.count / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

export function DashboardReports({ leads }: { leads: DashboardReportLead[] }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <LeadTrendChart leads={leads} />
      <PipelineValueChart leads={leads} />
      <MonthlyPipelineValueChart leads={leads} />
      <StageDistributionChart leads={leads} />
    </section>
  );
}
