import type { MessageStatus } from "@prisma/client";
import { MESSAGE_STATUS_META } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";

export type ChatMessage = {
  id: string;
  direction: "IN" | "OUT";
  status: MessageStatus;
  body: string;
  at: Date;
};

// Read-only chat-thread view of the LINE conversation on a lead. The same
// Message rows already power the Timeline audit; here they are rendered
// chronologically as bubbles (customer left, sales right) so a rep taking over
// the lead can read the full buy/sell conversation as handover evidence.
export function ChatHistory({
  messages,
  contactName,
  ownerName,
}: {
  messages: ChatMessage[];
  contactName: string;
  ownerName: string;
}) {
  const initial = contactName.trim().charAt(0) || "?";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          LINE Chat History · {messages.length}
        </h2>
        <span className="text-[11px] text-zinc-400">หลักฐานการสนทนา · อ้างอิงได้เมื่อเปลี่ยนผู้ดูแล</span>
      </div>

      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">ยังไม่มีบทสนทนา LINE</p>
      ) : (
        <ol className="mt-3 flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
          {messages.map((m) =>
            m.direction === "IN" ? (
              <li key={m.id} className="flex items-end gap-2">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                  {initial}
                </span>
                <div className="max-w-[75%]">
                  <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <div className="mt-0.5 pl-1 text-[11px] text-zinc-400">
                    {contactName} · <time dateTime={m.at.toISOString()}>{formatDateTime(m.at)}</time>
                  </div>
                </div>
              </li>
            ) : (
              <li key={m.id} className="flex flex-col items-end">
                <div className="max-w-[75%]">
                  <div className="rounded-2xl rounded-br-sm bg-[#06C755] px-3 py-2 text-sm text-white">
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5 pr-1 text-[11px] text-zinc-400">
                    {m.status !== "SENT" && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MESSAGE_STATUS_META[m.status]}`}>
                        {m.status}
                      </span>
                    )}
                    <span>{ownerName}</span>
                    <span>·</span>
                    <time dateTime={m.at.toISOString()}>{formatDateTime(m.at)}</time>
                  </div>
                </div>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
