"use client";

import { useState, useTransition } from "react";
import { createContactLineConnectLink } from "../actions";

// PLAN §11.9 officer side: generate a LINE connect link/QR for this contact. The
// customer opens it in LINE to bind their verified LINE identity to this record.
export function LineConnect({ contactId, lineLinked }: { contactId: string; lineLinked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await createContactLineConnectLink(contactId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUrl(res.url);
      try {
        const QRCode = (await import("qrcode")).default;
        setQr(await QRCode.toDataURL(res.url, { width: 200, margin: 1 }));
      } catch {
        /* QR is a nice-to-have; the link + copy still work */
      }
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; the field is selectable as a fallback */
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Connect LINE</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            {lineLinked
              ? "This contact is linked to a LINE account. Inbound LINE messages map to this record."
              : "Generate a link (or QR) for the customer to open in LINE and connect their account to this contact."}
          </p>
        </div>
        {lineLinked ? (
          <span className="inline-flex flex-none items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            เชื่อมต่อแล้ว ✓
          </span>
        ) : (
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="flex-none rounded-lg bg-[#06C755] px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
          >
            {pending ? "กำลังสร้าง…" : url ? "สร้างลิงก์ใหม่" : "สร้างลิงก์เชื่อมต่อ"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {!lineLinked && url && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="LINE connect QR" width={140} height={140} className="h-[140px] w-[140px] flex-none rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={copy} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}
              </button>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">ลิงก์หมดอายุใน 30 นาที</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
