"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask, toggleTaskDone } from "../actions";

export type LeadTask = {
  id: string;
  title: string;
  dueAt: string | null; // ISO string
  status: "OPEN" | "DONE";
};

const fieldClass =
  "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function isOverdue(t: LeadTask): boolean {
  return t.status === "OPEN" && t.dueAt != null && new Date(t.dueAt).getTime() < Date.now();
}

export function TasksPanel({ leadId, tasks }: { leadId: string; tasks: LeadTask[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createTask(leadId, { title, dueAt: dueAt || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTitle("");
      setDueAt("");
      router.refresh();
    });
  }

  function toggle(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await toggleTaskDone(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const openCount = tasks.filter((t) => t.status === "OPEN").length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Tasks · {openCount} open
      </h2>

      <form onSubmit={add} className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a follow-up…"
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={fieldClass} />
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {tasks.length === 0 ? (
        <p className="py-3 text-center text-sm text-zinc-400">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={t.status === "DONE"}
                onChange={() => toggle(t.id)}
                disabled={pending}
                className="h-4 w-4 flex-none accent-indigo-600"
              />
              <span className={`min-w-0 flex-1 truncate ${t.status === "DONE" ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-200"}`}>
                {t.title}
              </span>
              {t.dueAt && (
                <time
                  dateTime={t.dueAt}
                  className={`flex-none text-xs ${isOverdue(t) ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-400"}`}
                >
                  {new Date(t.dueAt).toLocaleDateString()}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
