"use client";

import { useEffect, useState } from "react";

// Shown when /liff is opened outside the LINE app (PC desktop or any external
// browser). Registration needs the in-LINE identity, so instead of bouncing to
// LINE login we hand the user off to their phone: a scannable QR + an "open in
// LINE" button pointing at the LIFF URL.
export function LiffDesktopLanding({ liffUrl }: { liffUrl: string }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(liffUrl, { width: 220, margin: 1 });
        if (!cancelled) setQr(dataUrl);
      } catch {
        /* QR is a nice-to-have; the button below still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffUrl]);

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        หน้านี้ออกแบบสำหรับเปิดผ่านแอป <span className="font-semibold">LINE</span> บนมือถือ
        <br />
        สแกน QR ด้านล่างด้วยมือถือ หรือกดปุ่มเพื่อเปิดใน LINE
      </p>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="สแกนเพื่อเปิดใน LINE" width={220} height={220} className="h-[220px] w-[220px]" />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center text-xs text-zinc-400">
            กำลังสร้าง QR…
          </div>
        )}
      </div>

      <a
        href={liffUrl}
        className="w-full rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95"
      >
        เปิดใน LINE
      </a>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        เมื่อเปิดผ่าน LINE บนมือถือแล้ว จะสามารถกรอกและบันทึกข้อมูลติดต่อได้ทันที
      </p>
    </div>
  );
}
