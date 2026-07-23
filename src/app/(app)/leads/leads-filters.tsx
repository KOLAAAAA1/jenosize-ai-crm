"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STAGES, SOURCES, STAGE_META, SOURCE_META } from "@/lib/crm";

type Owner = { id: string; name: string };

export function LeadsFilters({ owners, canFilterByOwner }: { owners: Owner[]; canFilterByOwner: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const firstRender = useRef(true);

  const stage = searchParams.get("stage") ?? "";
  const source = searchParams.get("source") ?? "";
  const owner = searchParams.get("owner") ?? "";
  const hasFilters = Boolean(q || stage || source || (canFilterByOwner && owner));

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page"); // any filter change resets to page 1
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  // Debounce the free-text search into the URL.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => setParam("q", q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, setParam]);

  const selectClass =
    "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Search title, company, or contact…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-56 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />

      <select value={stage} onChange={(e) => setParam("stage", e.target.value)} className={selectClass} aria-label="Filter by stage">
        <option value="">All stages</option>
        {STAGES.map((s) => (
          <option key={s} value={s}>{STAGE_META[s].label}</option>
        ))}
      </select>

      <select value={source} onChange={(e) => setParam("source", e.target.value)} className={selectClass} aria-label="Filter by source">
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s} value={s}>{SOURCE_META[s]}</option>
        ))}
      </select>

      {canFilterByOwner && (
        <select value={owner} onChange={(e) => setParam("owner", e.target.value)} className={selectClass} aria-label="Filter by owner">
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      )}

      {hasFilters && (
        <button
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname));
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Clear
        </button>
      )}
    </div>
  );
}
