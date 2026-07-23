"use client";

import { useState, useTransition } from "react";
import { approveAndSendEmailMessage, saveLeadEmailDraft } from "../actions";

export type PendingEmailDraft = {
  id: string;
  subject: string;
  body: string;
  status: "DRAFT" | "FAILED";
  toAddress: string | null;
};

export function EmailPanel({ leadId, drafts }: { leadId: string; drafts: PendingEmailDraft[] }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function saveDraft() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveLeadEmailDraft(leadId, { subject, body });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setSubject("");
      setBody("");
      setMessage("Email draft saved. Review and send it below.");
    });
  }

  function send(messageId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await approveAndSendEmailMessage(messageId);
      setMessage(result.ok ? "Email sent." : result.error);
    });
  }

  const fieldClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

  return (
    <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Email</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Draft first, then explicitly approve delivery through the configured email gateway.</p>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <input
          aria-label="Email subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Subject"
          maxLength={200}
          className={fieldClass}
        />
        <textarea
          aria-label="Email body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the email…"
          rows={4}
          maxLength={10_000}
          className={fieldClass}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveDraft}
            disabled={pending || !subject.trim() || !body.trim()}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {pending ? "Saving…" : "Save email draft"}
          </button>
        </div>
      </div>

      {drafts.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800/70 dark:border-zinc-800">
          {drafts.map((draft) => (
            <li key={draft.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{draft.subject}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">To: {draft.toAddress ?? "No contact email"}</p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{draft.body}</p>
                </div>
                <div className="flex flex-none flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${draft.status === "FAILED" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>{draft.status}</span>
                  <button
                    type="button"
                    onClick={() => send(draft.id)}
                    disabled={pending || !draft.toAddress}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {pending ? "Sending…" : draft.status === "FAILED" ? "Retry send" : "Approve & send"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {message && <p role="status" className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">{message}</p>}
    </section>
  );
}
