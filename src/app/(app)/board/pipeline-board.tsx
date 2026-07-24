"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import type { Stage } from "@prisma/client";
import { STAGE_META, STAGES } from "@/lib/crm";
import { formatTHB } from "@/lib/format";
import { groupLeadsByStage, type BoardLead } from "@/lib/pipeline";
import { moveLeadStage } from "../leads/actions";

type StageMove = { id: string; nextStage: Stage };

// Client board over a FLAT lead array. Columns are derived in render via the
// pure groupLeadsByStage, so a stage move only has to flip one lead's `stage`
// and both affected columns update. useOptimistic reconciles automatically:
// moveLeadStage revalidates /board, the RSC re-renders with a fresh `leads`
// prop, and the optimistic state resets to it.
export function PipelineBoard({ leads }: { leads: BoardLead[] }) {
  const [optimisticLeads, applyMove] = useOptimistic(
    leads,
    (state, move: StageMove) =>
      state.map((l) => (l.id === move.id ? { ...l, stage: move.nextStage } : l)),
  );
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = groupLeadsByStage(optimisticLeads);

  function moveLead(id: string, nextStage: Stage) {
    const lead = optimisticLeads.find((l) => l.id === id);
    if (!lead || lead.stage === nextStage) return; // no-op move

    setError(null);
    startTransition(async () => {
      applyMove({ id, nextStage });
      const res = await moveLeadStage(id, nextStage);
      if (!res.ok) setError(res.error); // optimistic state reverts on next render
    });
  }

  function onDrop(nextStage: Stage) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!id) return;
    moveLead(id, nextStage);
  }

  return (
    <div className="grid gap-3">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          Could not move lead: {error}
        </div>
      )}

      <div
        aria-label="Pipeline stages"
        className="-mx-4 grid auto-cols-[calc(100vw-3rem)] grid-flow-col snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [-webkit-overflow-scrolling:touch] sm:auto-cols-[20rem] lg:mx-0 lg:auto-cols-[17rem] lg:px-0"
      >
        {columns.map((col) => {
          const meta = STAGE_META[col.stage];
          const isTarget = overStage === col.stage;
          return (
            <section
              key={col.stage}
              onDragOver={(e) => {
                e.preventDefault();
                if (overStage !== col.stage) setOverStage(col.stage);
              }}
              onDragLeave={(e) => {
                // ignore bubbling from children; only clear when leaving the column
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setOverStage((s) => (s === col.stage ? null : s));
                }
              }}
              onDrop={() => onDrop(col.stage)}
              className={`grid min-h-[8rem] min-w-[calc(100vw-3rem)] content-start snap-center gap-2 rounded-xl border p-2.5 transition sm:min-w-[20rem] lg:min-w-0 ${isTarget
                  ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-600 dark:bg-indigo-950/30"
                  : "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40"
                }`}
            >
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{meta.label}</span>
                  <span className="text-xs tabular-nums text-zinc-400">{col.count}</span>
                </div>
              </div>
              <div className="px-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatTHB(col.totalValue)}
              </div>

              <div className="grid content-start gap-3">
                {col.leads.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`h-36 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm transition lg:h-28 lg:cursor-grab lg:active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 ${dragId === lead.id ? "opacity-50" : ""
                      } ${pending ? "pointer-events-none" : ""}`}
                  >
                    <Link
                      href={`/leads/${lead.id}`}
                      draggable={false}
                      className="block truncate text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {lead.title}
                    </Link>
                    <div title={`${lead.companyName} · ${lead.contactName}`} className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {lead.companyName} · {lead.contactName}
                    </div>
                    <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                      <span className="shrink-0 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatTHB(lead.valueTHB)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right text-xs text-zinc-400 dark:text-zinc-500">
                        {lead.ownerName}
                        {lead.score != null ? ` · ${lead.score}` : ""}
                      </span>
                    </div>
                    <label className="mt-3 flex items-center gap-2 lg:hidden">
                      <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">Move to</span>
                      <select
                        aria-label={`Move ${lead.title} to stage`}
                        value={lead.stage}
                        disabled={pending}
                        onChange={(event) => moveLead(lead.id, event.target.value as Stage)}
                        className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                      >
                        {STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_META[stage].label}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
                {col.leads.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
                    <span className="lg:hidden">No leads in this stage</span>
                    <span className="hidden lg:inline">Drop leads here</span>
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
