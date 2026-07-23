import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { contactName } from "@/lib/crm";

function isOverdue(dueAt: Date | null): boolean {
  return dueAt != null && dueAt.getTime() < Date.now();
}

// "My tasks due" — the session user's OPEN follow-ups across all their leads,
// earliest due first (undated last), overdue called out. Complements the
// per-lead TasksPanel (PLAN §11.2).
export default async function TasksPage() {
  const user = await requireUser();

  const tasks = await prisma.task.findMany({
    where: { ownerId: user.id, status: "OPEN" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: {
      lead: { select: { id: true, title: true, contact: { select: { firstName: true, lastName: true } } } },
    },
  });

  const overdue = tasks.filter((t) => isOverdue(t.dueAt));
  const rest = tasks.filter((t) => !isOverdue(t.dueAt));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">My tasks due</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {tasks.length} open task{tasks.length === 1 ? "" : "s"}
          {overdue.length > 0 ? ` · ${overdue.length} overdue` : ""}
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white py-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          No open tasks. Add follow-ups from a lead&apos;s detail page.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {[...overdue, ...rest].map((t) => {
              const od = isOverdue(t.dueAt);
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 bg-white px-4 py-3 dark:bg-zinc-950">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.title}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      <Link href={`/leads/${t.lead.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {t.lead.title}
                      </Link>{" "}
                      · {contactName(t.lead.contact)}
                    </p>
                  </div>
                  {t.dueAt && (
                    <time
                      dateTime={t.dueAt.toISOString()}
                      className={`flex-none text-xs tabular-nums ${od ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-400"}`}
                    >
                      {od ? "Overdue · " : ""}
                      {t.dueAt.toLocaleDateString()}
                    </time>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
