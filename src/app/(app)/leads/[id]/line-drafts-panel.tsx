"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndSendLineMessage, deleteLineDraft } from "../actions";

export type PendingLineDraft = {
  id: string;
  body: string;
  status: "DRAFT" | "FAILED";
};

export function LineDraftsPanel({ drafts }: { drafts: PendingLineDraft[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send(messageId: string) {
    setError(null);
    startTransition(async () => {
      const res = await approveAndSendLineMessage(messageId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(messageId: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteLineDraft(messageId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (drafts.length === 0) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
          LINE drafts · {drafts.length}
        </h2>
      </div>
      {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <ul className="flex flex-col gap-3">
        {drafts.map((draft) => (
          <li key={draft.id} className="rounded-lg border border-emerald-200 bg-white p-3 text-xs dark:border-emerald-900/60 dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {draft.status}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => remove(draft.id)}
                  disabled={pending}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Delete
                </button>
                <button
                  onClick={() => send(draft.id)}
                  disabled={pending}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {draft.status === "FAILED" ? "Retry send" : "Approve & send"}
                </button>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{draft.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
