"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INDUSTRIES, COMPANY_SIZES } from "@/lib/crm";

export function CompaniesFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const firstRender = useRef(true);

  const industry = searchParams.get("industry") ?? "";
  const size = searchParams.get("size") ?? "";
  const hasFilters = Boolean(q || industry || size);

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
        placeholder="Search name or website…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-56 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      <select value={industry} onChange={(e) => setParam("industry", e.target.value)} className={selectClass} aria-label="Filter by industry">
        <option value="">All industries</option>
        {INDUSTRIES.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select value={size} onChange={(e) => setParam("size", e.target.value)} className={selectClass} aria-label="Filter by size">
        <option value="">All sizes</option>
        {COMPANY_SIZES.map((v) => (
          <option key={v} value={v}>{v}</option>
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
