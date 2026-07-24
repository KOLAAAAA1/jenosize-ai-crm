"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STAGES, STAGE_META } from "@/lib/crm";
import { moveLeadStage } from "../actions";
import type { Stage } from "@prisma/client";

export function StageMover({ leadId, current }: { leadId: string; current: Stage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Stage;
    if (next === current) return;
    setError(null);
    startTransition(async () => {
      const res = await moveLeadStage(leadId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="lead-stage" className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Stage</label>
      <select
        id="lead-stage"
        value={current}
        onChange={onChange}
        disabled={pending}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>{STAGE_META[s].label}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-zinc-400">Saving…</span>}
      {error && <span className="basis-full text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
