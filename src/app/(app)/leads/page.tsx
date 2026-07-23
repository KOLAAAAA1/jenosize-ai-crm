import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageDirectory, leadScopeFor } from "@/lib/access-control";
import { isStage, isSource, STAGE_META, SOURCE_META, contactName } from "@/lib/crm";
import { buildLeadWhere } from "@/lib/leads-query";
import { formatTHB, formatDate } from "@/lib/format";
import { LeadsFilters } from "./leads-filters";

const PAGE_SIZE = 25;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = str(sp.q)?.trim() ?? "";
  const stageRaw = str(sp.stage);
  const stage = isStage(stageRaw) ? stageRaw : undefined;
  const sourceRaw = str(sp.source);
  const source = isSource(sourceRaw) ? sourceRaw : undefined;
  const ownerId = str(sp.owner) || undefined;
  const page = Math.max(1, Number.parseInt(str(sp.page) ?? "1", 10) || 1);

  const where = { ...buildLeadWhere({ q, stage, source, ownerId }), ...leadScopeFor(user) };

  const [total, leads, owners] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { company: true, contact: true, owner: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    canManageDirectory(user)
      ? prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (source) params.set("source", source);
    if (ownerId) params.set("owner", ownerId);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Leads</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString()} lead{total === 1 ? "" : "s"}
            {(q || stage || source || ownerId) ? " matching filters" : ""}
          </p>
        </div>
      </div>

      <LeadsFilters owners={owners} canFilterByOwner={canManageDirectory(user)} />

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-4 py-2.5 font-medium">Lead</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 text-right font-medium">Value</th>
              <th className="px-4 py-2.5 text-right font-medium">Score</th>
              <th className="px-4 py-2.5 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {leads.map((lead) => (
              <tr key={lead.id} className="bg-white transition hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {lead.title}
                  </Link>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{contactName(lead.contact)}</div>
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{lead.company.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_META[lead.stage].badge}`}>
                    {STAGE_META[lead.stage].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{SOURCE_META[lead.source]}</td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{lead.owner.name}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200">{formatTHB(lead.valueTHB)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{lead.score ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatDate(lead.updatedAt)}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No leads match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
        <span className="tabular-nums">
          {from}–{to} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Previous
            </Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">Previous</span>
          )}
          <span className="px-2 tabular-nums">Page {page} / {pageCount}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Next
            </Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
