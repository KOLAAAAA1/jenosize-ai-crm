"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CopilotSuggestion } from "@/lib/ai/schema";
import { reviewSuggestion, saveLineDraft } from "../actions";

export type PendingSuggestion = {
  id: string;
  createdBy: string;
  payload: CopilotSuggestion;
};

export function CopilotPanel({ leadId, suggestions }: { leadId: string; suggestions: PendingSuggestion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The copilot always returns something, but when the AI provider is unavailable
  // it degrades to the deterministic fallback (status "service_unavailable"). We
  // surface that so the user can retry the model manually (free tiers rate-limit
  // and recover) — the rule-based result is still shown meanwhile.
  const [serviceUnavailable, setServiceUnavailable] = useState(false);

  function generate() {
    setError(null);
    setServiceUnavailable(false);
    startTransition(async () => {
      const res = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      if (!res.ok) {
        setError(`Generate failed (${res.status})`);
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        suggestion?: { source?: string; status?: string };
      } | null;
      const s = data?.suggestion;
      if (s?.source === "fallback" || s?.status === "service_unavailable") {
        setServiceUnavailable(true);
      }
      router.refresh();
    });
  }

  function review(id: string, decision: "ACCEPTED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const res = await reviewSuggestion(id, decision);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function saveDraft(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await saveLineDraft(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          AI copilot{suggestions.length > 0 ? ` · ${suggestions.length} pending` : ""}
        </h2>
        <button
          onClick={generate}
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Working…" : "Generate suggestion"}
        </button>
      </div>

      {serviceUnavailable && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <span>บริการ AI ไม่พร้อมใช้งานชั่วคราว — แสดงผลแบบกำหนดกฎแทน คุณสามารถลองใหม่ได้</span>
          <button
            onClick={generate}
            disabled={pending}
            className="rounded-lg border border-amber-400 px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            {pending ? "กำลังลองใหม่…" : "ลองอีกครั้ง"}
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {suggestions.length === 0 ? (
        <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
          No pending suggestions. Generate one to summarise, score, and get a next-best action for this lead.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} disabled={pending} onReview={review} onSaveDraft={saveDraft} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  disabled,
  onReview,
  onSaveDraft,
}: {
  suggestion: PendingSuggestion;
  disabled: boolean;
  onReview: (id: string, decision: "ACCEPTED" | "REJECTED") => void;
  onSaveDraft: (id: string) => void;
}) {
  const p = suggestion.payload;
  const isFallback = p.source === "fallback";
  const lineDraft = p.lineReply?.draft?.trim() ?? null;

  return (
    <li className="rounded-lg border border-indigo-200 bg-white p-4 dark:border-indigo-900/60 dark:bg-zinc-900">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isFallback
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {isFallback ? "Deterministic fallback" : "AI-generated"}
        </span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{p.model}</span>
        {p.qualification.score != null && (
          <span className="ml-auto text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
            Score {p.qualification.score}
            <span className="ml-1 text-[11px] font-normal text-zinc-400">({p.qualification.confidence})</span>
          </span>
        )}
      </div>

      {p.warnings.length > 0 && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          {p.warnings.join(" ")}
        </p>
      )}

      <p className="text-sm text-zinc-700 dark:text-zinc-300">{p.summary.overview}</p>

      {p.summary.keyFacts.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
          {p.summary.keyFacts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      {p.qualification.reasons.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Reasons</span>
          <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
            {p.qualification.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {p.nextAction && (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">Next: {p.nextAction.action}</span>
          <span className="ml-2 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {p.nextAction.priority}
          </span>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">{p.nextAction.reason}</p>
        </div>
      )}

      {p.qualification.recommendedStage !== "no_change" && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Suggested stage: <span className="font-medium">{p.qualification.recommendedStage}</span> — apply manually via the stage selector.
        </p>
      )}

      {lineDraft && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <span className="font-semibold text-emerald-800 dark:text-emerald-200">Draft LINE reply</span>
          <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{lineDraft}</p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {lineDraft ? (
          <button
            onClick={() => onSaveDraft(suggestion.id)}
            disabled={disabled}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            Save LINE draft
          </button>
        ) : (
          <button
            onClick={() => onReview(suggestion.id, "ACCEPTED")}
            disabled={disabled}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            Accept
          </button>
        )}
        <button
          onClick={() => onReview(suggestion.id, "REJECTED")}
          disabled={disabled}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
