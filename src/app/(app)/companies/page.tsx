import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageDirectory } from "@/lib/access-control";
import { buildCompanyWhere } from "@/lib/companies-query";
import { CompaniesFilters } from "./companies-filters";

const PAGE_SIZE = 25;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canManageDirectory(user)) notFound();
  const sp = await searchParams;
  const q = str(sp.q)?.trim() ?? "";
  const industry = str(sp.industry) || undefined;
  const size = str(sp.size) || undefined;
  const page = Math.max(1, Number.parseInt(str(sp.page) ?? "1", 10) || 1);

  const where = buildCompanyWhere({ q, industry, size });

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      include: { _count: { select: { contacts: true, leads: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (industry) params.set("industry", industry);
    if (size) params.set("size", size);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/companies?${qs}` : "/companies";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Companies</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString()} compan{total === 1 ? "y" : "ies"}
            {q || industry || size ? " matching filters" : ""}
          </p>
        </div>
        <Link
          href="/companies/new"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New company
        </Link>
      </div>

      <CompaniesFilters />

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Industry</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 text-right font-medium">Contacts</th>
              <th className="px-4 py-2.5 text-right font-medium">Leads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {companies.map((c) => (
              <tr key={c.id} className="bg-white transition hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60">
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {c.name}
                  </Link>
                  {c.website && <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.website}</div>}
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{c.industry ?? "—"}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.size ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{c._count.contacts}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{c._count.leads}</td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No companies match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
        <span className="tabular-nums">{from}–{to} of {total.toLocaleString()}</span>
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Previous</Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">Previous</span>
          )}
          <span className="px-2 tabular-nums">Page {page} / {pageCount}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Next</Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
