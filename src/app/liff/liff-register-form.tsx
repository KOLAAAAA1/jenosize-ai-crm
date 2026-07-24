"use client";

import { useEffect, useState } from "react";

const fieldClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const labelClass = "text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

type Loaded = { linked: boolean };

// Register-or-update form. On mount it asks the server whether this verified LINE
// user is already a linked contact; if so it greets them and pre-fills their saved
// details (so a re-submit updates rather than blanks the record) instead of looking
// like a fresh "register new contact" form.
export function LiffRegisterForm({ idToken, displayName }: { idToken: string; displayName: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState({ firstName: displayName ?? "", lastName: "", email: "", phone: "", consent: false });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<"created" | "updated" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/line/liff-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.linked && json.contact) {
          setForm({
            firstName: json.contact.firstName || (displayName ?? ""),
            lastName: json.contact.lastName || "",
            email: json.contact.email || "",
            phone: json.contact.phone || "",
            consent: Boolean(json.contact.consent),
          });
          setLoaded({ linked: true });
        } else {
          setLoaded({ linked: false });
        }
      } catch {
        if (!cancelled) setLoaded({ linked: false }); // fall back to register form
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, displayName]);

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
        setFormError(json?.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setDone(json?.created ? "created" : "updated");
    } catch {
      setFormError("เครือข่ายมีปัญหา กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">กำลังตรวจสอบข้อมูลของคุณ…</p>;
  }

  const linked = loaded.linked;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {linked ? "คุณเชื่อมต่อ LINE แล้ว ✓" : "ลงทะเบียนข้อมูลติดต่อ"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {linked
            ? "ทีมงาน J. AI CRM ดูแลคุณอยู่ — ตรวจสอบและอัปเดตข้อมูลติดต่อของคุณได้ที่นี่"
            : "กรอกข้อมูลของคุณเพื่อให้ทีมงาน J. AI CRM ติดต่อกลับได้สะดวกยิ่งขึ้น"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {done && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {done === "created" ? "ลงทะเบียนสำเร็จ ✓" : "อัปเดตข้อมูลเรียบร้อย ✓"} ทีมงานจะติดต่อกลับผ่าน LINE
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
            <input className={fieldClass} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>นามสกุล *</span>
            <input className={fieldClass} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} required />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>อีเมล</span>
          <input type="email" className={fieldClass} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>เบอร์โทร</span>
          <input className={fieldClass} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} />
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            ยินยอมให้ J. AI CRM ติดต่อผ่าน LINE และจัดเก็บข้อมูลติดต่อของฉันตามนโยบายความเป็นส่วนตัว (PDPA)
          </span>
        </label>

        <button type="submit" disabled={submitting} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
          {submitting ? "กำลังบันทึก…" : done ? "บันทึกอีกครั้ง" : linked ? "อัปเดตข้อมูล" : "ลงทะเบียน"}
        </button>
      </form>
    </div>
  );
}
