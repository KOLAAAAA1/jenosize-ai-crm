"use client";

import { useState, useTransition } from "react";
import { setContactAutoReply } from "../actions";

// The same per-contact AI auto-reply switch that sits in the lead's chat box, shown
// here for admins/managers who administer a contact outside any one deal. Saves the
// moment it is toggled (optimistic UI), independent of the contact form's Save.
//
// Note the different authorisation: this page (and `setContactAutoReply`) is
// admin/manager-only, while the chat-box switch is lead-scoped so the assigned rep
// can flip it on their own conversation.
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
    <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Title and switch share a line; the explanation runs the full card width so
          it doesn't get squeezed into a narrow column on a phone. */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">AI Auto Reply</h2>

        <div className="flex flex-none items-center gap-2">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {pending ? "Saving…" : enabled ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle AI auto-reply for this contact"
            onClick={toggle}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 flex-none touch-manipulation items-center rounded-full transition-colors disabled:opacity-60 ${
              enabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            {/* Widens the tap target to ~44px without changing how the switch looks. */}
            <span aria-hidden="true" className="absolute -inset-2.5 rounded-full" />
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">
        Let the AI write and send the LINE reply when this customer messages the OA.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        On by default · saves instantly · switch it off to reply by hand from the lead&apos;s chat box.
        {!lineLinked && " Takes effect once a LINE user id is linked."}
      </p>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
