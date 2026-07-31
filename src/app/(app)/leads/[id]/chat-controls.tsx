"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendLineChatMessage, setLeadAiAutoReply } from "../actions";

// The interactive parts of the LINE chat box: the AI auto-reply switch (header),
// the manual composer (footer), and the scroll anchor that keeps the newest message
// in view. Kept as client children so ChatHistory itself stays a Server Component.
//
// The switch and the composer are one mode selector, not two independent features:
//   switch ON  → the AI answers every inbound message automatically; the composer is
//                closed, because a rep typing here would be racing the AI.
//   switch OFF → the OA stays silent and the rep owns the conversation from here.
// Sending is immediate (no separate approve step) — clicking Send *is* the approval.

export function AiAutoReplySwitch({
  leadId,
  enabled: initialEnabled,
  lineLinked,
}: {
  leadId: string;
  enabled: boolean;
  lineLinked: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setLeadAiAutoReply(leadId, next);
      if (!res.ok) {
        setEnabled(!next); // revert
        setError(res.error);
        return;
      }
      router.refresh(); // reveals/hides the composer below
    });
  }

  // On a phone this is a full-width row of its own (a bare switch floating under the
  // heading reads as an orphan); from `sm` up it collapses to an inline control
  // beside the heading.
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 sm:w-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 dark:border-zinc-800 dark:bg-zinc-800/40 dark:sm:bg-transparent">
      <span className="flex min-w-0 items-center gap-2 sm:justify-end">
        <span aria-hidden="true" className={enabled ? "" : "grayscale opacity-40"}>
          ✨
        </span>
        <span className="min-w-0 sm:text-right">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">AI auto-reply</span>
          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {pending ? "กำลังบันทึก…" : enabled ? "AI ตอบให้อัตโนมัติ" : "พิมพ์ตอบเอง"}
          </span>
        </span>
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle AI auto-reply for this customer"
        onClick={toggle}
        disabled={pending || !lineLinked}
        title={lineLinked ? undefined : "Link this contact to LINE first"}
        className={`relative inline-flex h-6 w-11 flex-none touch-manipulation items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        {/* Widens the tap target to ~44px without changing how the switch looks. */}
        <span aria-hidden="true" className="absolute -inset-2.5 rounded-full" />
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>

      {error && <span className="w-full text-xs text-red-600 sm:w-auto dark:text-red-400">{error}</span>}
    </div>
  );
}

export function ChatComposer({
  leadId,
  aiEnabled,
  lineLinked,
  optedOut,
}: {
  leadId: string;
  aiEnabled: boolean;
  lineLinked: boolean;
  optedOut: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Enter-to-send is a desktop convention. On a touch keyboard Enter means "new
  // line", and hijacking it makes the composer feel broken — so it is enabled only
  // for fine pointers. The server snapshot is `false`, so hydration matches and the
  // hint only appears once the real pointer type is known.
  const enterSends = useSyncExternalStore(subscribePointerFine, pointerIsFine, () => false);

  // Grow with the text instead of scrolling inside a fixed box. `scrollHeight`
  // excludes the borders under border-box sizing, so they are added back — without
  // that the field is a couple of pixels short and shows a scrollbar on one line.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + borders, 140)}px`;
  }, [body]);

  if (!lineLinked) {
    return (
      <ComposerNote>ยังไม่ได้เชื่อม LINE กับผู้ติดต่อนี้ — เชื่อมก่อนจึงจะส่งข้อความได้</ComposerNote>
    );
  }

  if (aiEnabled) {
    return (
      <ComposerNote>
        <span aria-hidden="true" className="mr-1">
          ✨
        </span>
        AI ตอบลูกค้าอัตโนมัติอยู่ — ปิดสวิตช์ด้านบนเพื่อพิมพ์ตอบเอง
      </ComposerNote>
    );
  }

  function send() {
    const text = body.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await sendLineChatMessage(leadId, text);
      if (!res.ok) {
        setError(res.error);
        router.refresh(); // a failed send leaves a FAILED draft worth showing
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      {optedOut && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">ลูกค้าปฏิเสธการติดต่อ (OPTED_OUT) — ส่งไม่ได้</p>
      )}
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (enterSends && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="พิมพ์ข้อความตอบลูกค้า…"
          aria-label="ข้อความตอบลูกค้าทาง LINE"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          disabled={pending || optedOut}
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || optedOut || !body.trim()}
          aria-label="ส่งข้อความ"
          className="flex h-11 w-11 flex-none touch-manipulation items-center justify-center rounded-full bg-[#06C755] text-white transition hover:brightness-110 disabled:opacity-40 sm:h-11 sm:w-auto sm:rounded-2xl sm:px-5 sm:text-sm sm:font-medium"
        >
          {/* Icon-only on phones (thumb-sized), labelled from `sm` up. */}
          <span aria-hidden="true" className="sm:hidden">
            {pending ? "…" : "➤"}
          </span>
          <span className="hidden sm:inline">{pending ? "กำลังส่ง…" : "ส่ง"}</span>
        </button>
      </div>

      {/* The keyboard hint is only true where Enter actually sends. */}
      {enterSends && (
        <p className="mt-1.5 hidden text-[11px] text-zinc-400 sm:block">Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่</p>
      )}
    </div>
  );
}

const POINTER_FINE = "(pointer: fine)";

function pointerIsFine(): boolean {
  return window.matchMedia(POINTER_FINE).matches;
}

function subscribePointerFine(onChange: () => void): () => void {
  const query = window.matchMedia(POINTER_FINE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function ComposerNote({ children }: { children: React.ReactNode }) {
  // Deliberately not a flex row: flex would treat the leading emoji as its own item
  // and strand it on a line of its own once the sentence wraps.
  return (
    <p className="mt-3 border-t border-zinc-100 pt-3 text-center text-xs leading-relaxed text-balance text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {children}
    </p>
  );
}

// A chat opens at the newest message, not the oldest. Rendered as the last child of
// the scrolling thread so it can pull its own container down on load; `block: "end"`
// keeps the rest of the page where it was.
export function ChatScrollAnchor({ dependency }: { dependency: number }) {
  const anchor = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = anchor.current;
    const scroller = el?.parentElement;
    if (!el || !scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [dependency]);

  return <li ref={anchor} aria-hidden="true" className="h-px" />;
}
