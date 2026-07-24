"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CONSENT_STATUSES, CONSENT_META } from "@/lib/crm";

export function ContactsFilters({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const firstRender = useRef(true);

  const company = searchParams.get("company") ?? "";
  const line = searchParams.get("line") ?? "";
  const consent = searchParams.get("consent") ?? "";
  const hasFilters = Boolean(q || company || line || consent);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => setParam("q", q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, setParam]);

  const selectClass =
    "max-w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Search name, email, or phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-56 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      <select value={company} onChange={(e) => setParam("company", e.target.value)} className={selectClass} aria-label="Filter by company">
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select value={line} onChange={(e) => setParam("line", e.target.value)} className={selectClass} aria-label="Filter by LINE link">
        <option value="">LINE: any</option>
        <option value="yes">Has LINE</option>
        <option value="no">No LINE</option>
      </select>
      <select value={consent} onChange={(e) => setParam("consent", e.target.value)} className={selectClass} aria-label="Filter by consent">
        <option value="">All consent</option>
        {CONSENT_STATUSES.map((v) => (
          <option key={v} value={v}>{CONSENT_META[v].label}</option>
        ))}
      </select>
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
