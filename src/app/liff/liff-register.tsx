"use client";

import { useEffect, useState } from "react";
import { LiffRegisterForm } from "./liff-register-form";
import { LiffLink } from "./liff-link";
import { LiffDesktopLanding } from "./liff-desktop-landing";

type Phase =
  | { kind: "loading" }
  | { kind: "desktop" } // opened outside the LINE app → hand off to phone
  | { kind: "ready"; idToken: string; displayName: string | null; linkToken: string | null } // in-LINE, verified
  | { kind: "error"; message: string };

// The connect link token must be read on the client AFTER liff.init(): when a
// not-logged-in user hits liff.login(), LIFF stashes the original query in a
// `liff.state` param and only restores it post-init, so a server-side
// searchParams read would miss it. Check the plain query first, then liff.state.
function readLinkToken(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const direct = params.get("token");
  if (direct) return direct;
  const state = params.get("liff.state");
  if (state) {
    const inner = new URLSearchParams(state.startsWith("?") ? state.slice(1) : state);
    return inner.get("token");
  }
  return null;
}

export function LiffRegister({ liffId }: { liffId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });

        // Not inside the LINE app (PC desktop / external browser): show the
        // separate landing view instead of forcing a LINE login.
        if (!liff.isInClient()) {
          if (!cancelled) setPhase({ kind: "desktop" });
          return;
        }

        if (!liff.isLoggedIn()) {
          liff.login(); // redirects; component remounts after return
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          throw new Error(
            "ไม่พบข้อมูลยืนยันตัวตน (ID token). กรุณาเปิดสิทธิ์ OpenID ของ LIFF app แล้วลองใหม่",
          );
        }
        const profile = await liff.getProfile().catch(() => null);
        if (cancelled) return;
        setPhase({ kind: "ready", idToken, displayName: profile?.displayName ?? null, linkToken: readLinkToken() });
      } catch (err) {
        if (cancelled) return;
        setPhase({ kind: "error", message: err instanceof Error ? err.message : "LIFF init failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  if (phase.kind === "loading") {
    return <p className="flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">กำลังเชื่อมต่อ LINE…</p>;
  }
  if (phase.kind === "desktop") {
    return <LiffDesktopLanding liffUrl={`https://liff.line.me/${liffId}`} />;
  }
  if (phase.kind === "error") {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        {phase.message}
      </p>
    );
  }

  // Link mode (officer-minted token in the URL) vs register/update (the form
  // greets an already-linked user with their saved details, else a blank form).
  if (phase.linkToken) {
    return <LiffLink idToken={phase.idToken} token={phase.linkToken} displayName={phase.displayName} />;
  }
  return <LiffRegisterForm idToken={phase.idToken} displayName={phase.displayName} />;
}
