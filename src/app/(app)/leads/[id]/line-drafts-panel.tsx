"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndSendLineMessage, deleteLineDraft } from "../actions";

export type PendingLineDraft = {
  id: string;
  body: string;
  status: "DRAFT" | "FAILED";
};

// Nested inside the LINE chat box, directly above the composer — these are messages
// waiting on a human: a copilot draft saved for review, or an AI auto-reply whose
// send failed. Renders nothing when there are none, so the chat box stays quiet.
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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
        รอส่ง · LINE drafts · {drafts.length}
      </h2>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <ul className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <li key={draft.id} className="rounded-lg border border-emerald-200 bg-white p-3 text-xs dark:border-emerald-900/60 dark:bg-zinc-900">
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {draft.status}
            </span>
            <p className="mt-2 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">{draft.body}</p>
            {/* Actions under the text: on a phone they'd otherwise squeeze the status
                pill into a corner and end up below the fold of the row anyway. */}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => remove(draft.id)}
                disabled={pending}
                className="touch-manipulation rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Delete
              </button>
              <button
                onClick={() => send(draft.id)}
                disabled={pending}
                className="touch-manipulation rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {draft.status === "FAILED" ? "Retry send" : "Approve & send"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
