"use client";

import { useState } from "react";

// Link mode: shown when /liff is opened with a signed connect token (an officer
// generated it for a specific contact). The customer confirms PDPA consent and
// taps connect; the server binds their verified LINE identity to that contact.
export function LiffLink({ idToken, token, displayName }: { idToken: string; token: string; displayName: string | null }) {
  const [consent, setConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onConnect() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/line/liff-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, token, consent }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setDone(true);
    } catch {
      setError("เครือข่ายมีปัญหา กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">เชื่อมต่อบัญชี LINE</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {displayName ? `สวัสดีคุณ ${displayName} — ` : ""}เชื่อมต่อ LINE ของคุณกับข้อมูลติดต่อในระบบ เพื่อให้ทีมงาน J. AI CRM ดูแลได้ต่อเนื่อง
        </p>
      </div>

      {done ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          เชื่อมต่อบัญชี LINE สำเร็จ ✓ ทีมงานจะติดต่อกลับผ่าน LINE นี้
        </div>
      ) : (
        <>
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-indigo-600"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              ยินยอมให้ J. AI CRM ติดต่อผ่าน LINE และจัดเก็บข้อมูลติดต่อของฉันตามนโยบายความเป็นส่วนตัว (PDPA)
            </span>
          </label>

          <button
            type="button"
            onClick={onConnect}
            disabled={submitting}
            className="rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
          >
            {submitting ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อบัญชี LINE"}
          </button>
        </>
      )}
    </div>
  );
}
