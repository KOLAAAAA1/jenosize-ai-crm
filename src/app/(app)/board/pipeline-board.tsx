"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import type { Stage } from "@prisma/client";
import { STAGE_META } from "@/lib/crm";
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

  function onDrop(nextStage: Stage) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!id) return;

    const lead = optimisticLeads.find((l) => l.id === id);
    if (!lead || lead.stage === nextStage) return; // no-op drop

    setError(null);
    startTransition(async () => {
      applyMove({ id, nextStage });
      const res = await moveLeadStage(id, nextStage);
      if (!res.ok) setError(res.error); // optimistic state reverts on next render
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          Could not move lead: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
              className={`flex min-h-[8rem] flex-col gap-2 rounded-xl border p-2.5 transition ${
                isTarget
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

              <div className="flex flex-col gap-2">
                {col.leads.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`cursor-grab rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm transition active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 ${
                      dragId === lead.id ? "opacity-50" : ""
                    } ${pending ? "pointer-events-none" : ""}`}
                  >
                    <Link
                      href={`/leads/${lead.id}`}
                      draggable={false}
                      className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {lead.title}
                    </Link>
                    <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {lead.companyName} · {lead.contactName}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatTHB(lead.valueTHB)}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {lead.ownerName}
                        {lead.score != null ? ` · ${lead.score}` : ""}
                      </span>
                    </div>
                  </article>
                ))}
                {col.leads.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-zinc-400 dark:text-zinc-600">Drop leads here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
