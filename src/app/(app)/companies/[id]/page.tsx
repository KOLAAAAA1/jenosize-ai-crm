import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CONSENT_META, SOURCE_META, STAGE_META, contactName } from "@/lib/crm";
import { formatTHB, formatDate } from "@/lib/format";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ firstName: "asc" }, { lastName: "asc" }] },
      leads: {
        include: { contact: { select: { firstName: true, lastName: true } }, owner: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!company) notFound();

  const info: { label: string; value: string }[] = [
    { label: "Industry", value: company.industry ?? "—" },
    { label: "Size", value: company.size ?? "—" },
    { label: "Website", value: company.website ?? "—" },
    { label: "Created", value: formatDate(company.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/companies" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Companies</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{company.name}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {company.contacts.length} contact{company.contacts.length === 1 ? "" : "s"} · {company.leads.length} lead{company.leads.length === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            href={`/companies/${company.id}/edit`}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Details</h2>
            <dl className="flex flex-col gap-3">
              {info.map((row) => (
                <div key={row.label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-zinc-500 dark:text-zinc-400">{row.label}</dt>
                  <dd className="truncate text-right font-medium text-zinc-800 dark:text-zinc-200">{row.value}</dd>
                </div>
              ))}
            </dl>
            {company.notes && (
              <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">{company.notes}</p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-6 lg:col-span-2">
          {/* Contacts */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Contacts · {company.contacts.length}</h2>
              <Link href={`/contacts/new?company=${company.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">+ Add contact</Link>
            </div>
            {company.contacts.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">No contacts yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {company.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/contacts/${c.id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{contactName(c)}</Link>
                      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {[c.title, c.email].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {c.lineUserId && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">LINE</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CONSENT_META[c.consentStatus].badge}`}>{CONSENT_META[c.consentStatus].label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Leads */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Leads · {company.leads.length}</h2>
            {company.leads.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">No leads yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {company.leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/leads/${l.id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{l.title}</Link>
                      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{contactName(l.contact)} · {SOURCE_META[l.source]} · {l.owner.name}</div>
                    </div>
                    <div className="flex flex-none items-center gap-3">
                      <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{formatTHB(l.valueTHB)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_META[l.stage].badge}`}>{STAGE_META[l.stage].label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
