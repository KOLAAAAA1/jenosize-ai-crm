"use client";

import { useState, useTransition } from "react";
import { setContactAutoReply } from "../actions";

// Standalone Auto Reply switch shown at the top of the contact detail page. Saves
// to the database the moment it is toggled (optimistic UI), independent of the
// main contact form's Save button.
export function AutoReplyToggle({
  contactId,
  initialEnabled,
  lineLinked,
}: {
  contactId: string;
  initialEnabled: boolean;
  lineLinked: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setContactAutoReply(contactId, next);
      if (!res.ok) {
        setEnabled(!next); // revert
        setError(res.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Auto Reply</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Send an automatic LINE greeting when this customer messages the OA.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Off by default · saves instantly · does not affect the AI copilot.
            {!lineLinked && " Takes effect once a LINE user id is linked."}
          </p>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex flex-none flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle LINE greeting auto-reply"
            onClick={toggle}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors disabled:opacity-60 ${
              enabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {pending ? "Saving…" : enabled ? "On" : "Off"}
          </span>
        </div>
      </div>
    </section>
  );
}
