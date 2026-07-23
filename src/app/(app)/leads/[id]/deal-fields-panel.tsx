"use client";

import { useState, useTransition } from "react";
import { saveLeadDealFields } from "../actions";

function dateValue(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export function DealFieldsPanel({
  leadId,
  probability,
  expectedCloseAt,
}: {
  leadId: string;
  probability: number | null;
  expectedCloseAt: string | null;
}) {
  const [probabilityValue, setProbabilityValue] = useState(probability?.toString() ?? "");
  const [closeDate, setCloseDate] = useState(dateValue(expectedCloseAt));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    const parsedProbability = probabilityValue.trim() === "" ? null : Number(probabilityValue);
    setMessage(null);
    startTransition(async () => {
      const result = await saveLeadDealFields(leadId, {
        probability: Number.isFinite(parsedProbability) ? parsedProbability : Number.NaN,
        expectedCloseAt: closeDate || null,
      });
      setMessage(result.ok ? "Deal details saved." : result.error);
    });
  }

  const fieldClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

  return (
    <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deal details</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Win probability</span>
          <div className="relative">
            <input
              aria-label="Win probability"
              type="number"
              min="0"
              max="100"
              inputMode="numeric"
              value={probabilityValue}
              onChange={(event) => setProbabilityValue(event.target.value)}
              placeholder="Not set"
              className={`${fieldClass} pr-8`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-400">%</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Expected close</span>
          <input
            aria-label="Expected close date"
            type="date"
            value={closeDate}
            onChange={(event) => setCloseDate(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p aria-live="polite" className={`text-xs ${message === "Deal details saved." ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {message}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="flex-none rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {pending ? "Saving…" : "Save deal"}
        </button>
      </div>
    </section>
  );
}
