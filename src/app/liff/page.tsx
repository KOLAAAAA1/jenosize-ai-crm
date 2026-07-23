import { LiffRegister } from "./liff-register";

// Public, customer-facing self-registration page — opened inside LINE via LIFF.
// Deliberately outside the (app) route group, so it is NOT behind the CRM login.
export const metadata = { title: "J. AI CRM — ลงทะเบียน" };

export default function LiffPage() {
  const liffId = process.env.LINE_LIFF_ID?.trim() || "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">ลงทะเบียนข้อมูลติดต่อ</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          กรอกข้อมูลของคุณเพื่อให้ทีมงาน J. AI CRM ติดต่อกลับได้สะดวกยิ่งขึ้น
        </p>
      </div>

      {liffId ? (
        <LiffRegister liffId={liffId} />
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          LIFF is not configured (missing <code>LINE_LIFF_ID</code>). Set it in the environment and redeploy.
        </p>
      )}
    </main>
  );
}
