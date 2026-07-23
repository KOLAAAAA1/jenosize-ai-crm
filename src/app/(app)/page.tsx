import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageDirectory, leadScopeFor } from "@/lib/access-control";
import type { Stage } from "@prisma/client";

const STAGE_ORDER: Stage[] = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"];

export default async function DashboardPage() {
  const user = await requireUser();
  const allRecords = canManageDirectory(user);
  const leadScope = leadScopeFor(user);

  const [companies, contacts, leads, openSuggestions, byStageRaw] = await Promise.all([
    prisma.company.count({ where: allRecords ? {} : { leads: { some: { ownerId: user.id } } } }),
    prisma.contact.count({ where: allRecords ? {} : { leads: { some: { ownerId: user.id } } } }),
    prisma.lead.count({ where: leadScope }),
    prisma.aiSuggestion.count({ where: { status: "SUGGESTED", ...(allRecords ? {} : { lead: { ownerId: user.id } }) } }),
    prisma.lead.groupBy({ by: ["stage"], where: leadScope, _count: { _all: true } }),
  ]);

  const stageCounts = new Map(byStageRaw.map((r) => [r.stage, r._count._all]));

  const stats = [
    { label: allRecords ? "Companies" : "My companies", value: companies },
    { label: allRecords ? "Contacts" : "My contacts", value: contacts },
    { label: allRecords ? "Leads" : "My leads", value: leads },
    { label: "AI suggestions to review", value: openSuggestions },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome back, {user.name.split(" ")[0] || "there"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your pipeline at a glance. Lists, board, and lead detail land in the next block.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{s.value.toLocaleString()}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Pipeline by stage</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STAGE_ORDER.map((stage) => (
            <div key={stage} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{stage}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{stageCounts.get(stage) ?? 0}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
