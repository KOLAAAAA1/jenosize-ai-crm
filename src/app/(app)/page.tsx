import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageDirectory, leadScopeFor } from "@/lib/access-control";
import { buildDashboardMetrics, sevenDaysAgo } from "@/lib/dashboard-metrics";
import { formatTHB } from "@/lib/format";
import { DashboardReports } from "./dashboard-charts";

export default async function DashboardPage() {
  const user = await requireUser();
  const allRecords = canManageDirectory(user);
  const leadScope = leadScopeFor(user);
  const activityWindowStartsAt = sevenDaysAgo();

  const [companies, contacts, openSuggestions, leadRows, recentActivities] = await Promise.all([
    prisma.company.count({ where: allRecords ? {} : { leads: { some: { ownerId: user.id } } } }),
    prisma.contact.count({ where: allRecords ? {} : { leads: { some: { ownerId: user.id } } } }),
    prisma.aiSuggestion.count({ where: { status: "SUGGESTED", ...(allRecords ? {} : { lead: { ownerId: user.id } }) } }),
    // Reports filter (owner/company/month/stage) entirely client-side for instant
    // interaction, so the full permitted lead set is fetched once and shipped flat.
    // Deliberately unbounded — correct at this app's scale (a single team). If the
    // lead volume ever grows large, move filtering to server actions rather than
    // capping this query, which would undercount the aggregates.
    prisma.lead.findMany({
      where: leadScope,
      select: {
        stage: true,
        valueTHB: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.activity.count({
      where: { createdAt: { gte: activityWindowStartsAt }, ...(allRecords ? {} : { lead: { ownerId: user.id } }) },
    }),
  ]);
  // Server-side pass powers the summary tiles below (whole permitted scope). The
  // client re-runs buildDashboardMetrics per active filter for the report cards —
  // the two are intentionally separate, not redundant; don't collapse them.
  const metrics = buildDashboardMetrics(leadRows);
  const dashboardLeads = leadRows.map((lead) => ({
    stage: lead.stage,
    valueTHB: lead.valueTHB,
    createdAt: lead.createdAt.toISOString(),
    ownerId: lead.owner.id,
    ownerName: lead.owner.name,
    companyId: lead.company.id,
    companyName: lead.company.name,
  }));

  const stats = [
    { label: allRecords ? "Companies" : "My companies", value: companies },
    { label: allRecords ? "Contacts" : "My contacts", value: contacts },
    { label: allRecords ? "Leads" : "My leads", value: leadRows.length },
    { label: "AI suggestions to review", value: openSuggestions },
    { label: "Open pipeline value", value: formatTHB(metrics.openPipelineValue) },
    { label: "Win rate", value: metrics.winRate === null ? "—" : `${metrics.winRate}%` },
    { label: "Activities · 7 days", value: recentActivities },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome back, {user.name.split(" ")[0] || "there"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Track the current view&apos;s pipeline volume, value, conversion, and lead creation trend.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</p>
          </div>
        ))}
      </section>

      <DashboardReports leads={dashboardLeads} />
    </div>
  );
}
