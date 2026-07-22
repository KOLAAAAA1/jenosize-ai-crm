import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { STAGE_META, contactName } from "@/lib/crm";
import { formatTHB } from "@/lib/format";
import { ContactForm } from "../contact-form";
import { AutoReplyToggle } from "./auto-reply-toggle";

// `/contacts/[id]` is the edit page (deliberate asymmetry with companies — a
// contact is simple enough that a dedicated read-only detail adds little). The
// contact's leads are shown alongside the form for context.
export default async function ContactEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [contact, companies] = await Promise.all([
    prisma.contact.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        leads: { include: { owner: { select: { name: true } } }, orderBy: { updatedAt: "desc" } },
      },
    }),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!contact) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/contacts" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Contacts</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{contactName(contact)}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href={`/companies/${contact.company.id}`} className="hover:underline">{contact.company.name}</Link>
        </p>
      </div>

      <AutoReplyToggle
        contactId={contact.id}
        initialEnabled={contact.autoReplyEnabled}
        lineLinked={contact.lineUserId != null}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Edit contact</h2>
          <ContactForm companies={companies} initial={contact} />
        </div>

        <section className="lg:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Leads · {contact.leads.length}</h2>
            {contact.leads.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">No leads for this contact.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {contact.leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/leads/${l.id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{l.title}</Link>
                      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{formatTHB(l.valueTHB)} · {l.owner.name}</div>
                    </div>
                    <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_META[l.stage].badge}`}>{STAGE_META[l.stage].label}</span>
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
