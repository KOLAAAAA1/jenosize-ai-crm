import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageDirectory } from "@/lib/access-control";
import { buildContactWhere } from "@/lib/contacts-query";
import { CONSENT_META, contactName } from "@/lib/crm";
import { ContactsFilters } from "./contacts-filters";

const PAGE_SIZE = 25;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canManageDirectory(user)) notFound();
  const sp = await searchParams;
  const q = str(sp.q)?.trim() ?? "";
  const companyId = str(sp.company) || undefined;
  const line = str(sp.line) || undefined;
  const consent = str(sp.consent) || undefined;
  const page = Math.max(1, Number.parseInt(str(sp.page) ?? "1", 10) || 1);

  const where = buildContactWhere({ q, companyId, line, consent });

  const [total, contacts, companies] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      include: { company: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (companyId) params.set("company", companyId);
    if (line) params.set("line", line);
    if (consent) params.set("consent", consent);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Contacts</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString()} contact{total === 1 ? "" : "s"}
            {q || companyId || line || consent ? " matching filters" : ""}
          </p>
        </div>
        <Link href="/contacts/new" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          New contact
        </Link>
      </div>

      <ContactsFilters companies={companies} />

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-4 py-2.5 font-medium">Contact</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">LINE</th>
              <th className="px-4 py-2.5 font-medium">Consent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {contacts.map((c) => (
              <tr key={c.id} className="bg-white transition hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60">
                <td className="px-4 py-3">
                  <Link href={`/contacts/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{contactName(c)}</Link>
                  {c.title && <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.title}</div>}
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{c.company.name}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.email ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">{c.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    {c.lineUserId ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Linked</span> : <span className="text-zinc-400">—</span>}
                    {/* AI auto-reply is on by default, so the exception is what's
                        worth a badge: this customer is answered by a human. */}
                    {c.lineUserId && !c.autoReplyEnabled && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">AI off</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONSENT_META[c.consentStatus].badge}`}>{CONSENT_META[c.consentStatus].label}</span>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">No contacts match your filters.</td>
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
