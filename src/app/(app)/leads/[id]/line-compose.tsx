"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLineDraft } from "../actions";

// Manual LINE reply composer (Block 9). A rep types a reply → saved as a
// Message(DRAFT) that appears in LineDraftsPanel for the approve→send step. Only
// rendered when the contact is LINE-linked (there's someone to send to).
export function LineCompose({ leadId, lineLinked, optedOut }: { leadId: string; lineLinked: boolean; optedOut: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!lineLinked) return null;

  function save() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createLineDraft(leadId, body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      router.refresh(); // the new DRAFT shows up in the LINE drafts panel below
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Compose LINE reply</h2>
      {optedOut && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">ลูกค้าปฏิเสธการติดต่อ (OPTED_OUT) — ส่งไม่ได้</p>}
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="พิมพ์ข้อความตอบกลับลูกค้า… (บันทึกเป็นฉบับร่างก่อนอนุมัติส่ง)"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
        disabled={pending || optedOut}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending || optedOut || !body.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกฉบับร่าง"}
        </button>
      </div>
    </div>
  );
}
