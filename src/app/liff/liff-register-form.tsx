"use client";

import { useState } from "react";

const fieldClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const labelClass = "text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

// The in-LINE registration form. Rendered only once we have a verified idToken
// (i.e. running inside the LINE client). Desktop users see LiffDesktopLanding.
export function LiffRegisterForm({ idToken, displayName }: { idToken: string; displayName: string | null }) {
  const [form, setForm] = useState({
    firstName: displayName ?? "",
    lastName: "",
    email: "",
    phone: "",
    consent: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<"created" | "updated" | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/line/liff-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, idToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json?.error ?? "ลงทะเบียนไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setDone(json?.created ? "created" : "updated");
    } catch {
      setFormError("เครือข่ายมีปัญหา กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {done && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {done === "created" ? "ลงทะเบียนสำเร็จ ✓" : "อัปเดตข้อมูลเรียบร้อย ✓"} ทีมงานจะติดต่อกลับผ่าน LINE
          — แก้ไขแล้วกดบันทึกอีกครั้งได้
        </div>
      )}
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>ชื่อ *</span>
          <input
            className={fieldClass}
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>นามสกุล *</span>
          <input
            className={fieldClass}
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            required
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>อีเมล</span>
        <input
          type="email"
          className={fieldClass}
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>เบอร์โทร</span>
        <input
          className={fieldClass}
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </label>

      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-indigo-600"
          checked={form.consent}
          onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))}
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-300">
          ยินยอมให้ J. AI CRM ติดต่อผ่าน LINE และจัดเก็บข้อมูลติดต่อของฉันตามนโยบายความเป็นส่วนตัว (PDPA)
        </span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {submitting ? "กำลังบันทึก…" : done ? "บันทึกอีกครั้ง" : "ลงทะเบียน"}
      </button>
    </form>
  );
}
