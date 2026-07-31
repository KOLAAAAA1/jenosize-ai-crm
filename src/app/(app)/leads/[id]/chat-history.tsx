import type { MessageStatus } from "@prisma/client";
import { MESSAGE_STATUS_META } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { AiAutoReplySwitch, ChatComposer, ChatScrollAnchor } from "./chat-controls";

export type ChatMessage = {
  id: string;
  direction: "IN" | "OUT";
  status: MessageStatus;
  body: string;
  at: Date;
  // Outbound only: who wrote it. AI auto-replies must not be attributed to the
  // human owner — a rep reading the handover needs to know which words are theirs.
  via: "ai" | "human";
};

// The LINE conversation on a lead: the same Message rows that power the Timeline
// audit, rendered chronologically as bubbles (customer left, sales right) so a rep
// taking over can read the whole buy/sell conversation as handover evidence.
//
// Everything that acts on the conversation lives here too, in reading order:
// the AI copilot (collapsed), the thread, drafts waiting to be sent, and the
// composer. Choosing who answers, deciding what to say, and saying it used to be
// spread across two columns; keeping them together is the point of this component.
//
// `copilot` and `drafts` are passed in as nodes rather than data so this file stays
// about the conversation and never has to know about AI payloads or message ids.
export function ChatHistory({
  messages,
  contactName,
  ownerName,
  leadId,
  aiAutoReplyEnabled,
  lineLinked,
  optedOut,
  copilot,
  drafts,
}: {
  messages: ChatMessage[];
  contactName: string;
  ownerName: string;
  leadId: string;
  aiAutoReplyEnabled: boolean;
  lineLinked: boolean;
  optedOut: boolean;
  copilot?: React.ReactNode;
  drafts?: React.ReactNode;
}) {
  const initial = contactName.trim().charAt(0) || "?";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Phone: heading, then the switch as its own full-width row. sm+: side by side. */}
      <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            LINE Chat History · {messages.length}
          </h2>
          <span className="block text-[11px] text-zinc-400">หลักฐานการสนทนา · อ้างอิงได้เมื่อเปลี่ยนผู้ดูแล</span>
        </div>
        <AiAutoReplySwitch leadId={leadId} enabled={aiAutoReplyEnabled} lineLinked={lineLinked} />
      </div>

      {copilot && <div className="mt-3">{copilot}</div>}

      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <span aria-hidden="true" className="text-2xl opacity-40">
            💬
          </span>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">ยังไม่มีบทสนทนา LINE</p>
          <p className="text-xs text-zinc-400">ข้อความจากลูกค้าและคำตอบจะแสดงที่นี่</p>
        </div>
      ) : (
        // Caps at ~60% of a phone screen so the thread never eats the whole viewport,
        // and at a fixed height on larger screens where there is room to spare.
        <ol className="mt-3 flex max-h-[60vh] flex-col gap-3 overflow-y-auto overscroll-contain pr-1 sm:max-h-[28rem]">
          {messages.map((m) =>
            m.direction === "IN" ? (
              <li key={m.id} className="flex items-end gap-2">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                  {initial}
                </span>
                <div className="max-w-[85%] sm:max-w-[75%]">
                  <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-sm text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-1 text-[11px] text-zinc-400">
                    <span className="truncate">{contactName}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={m.at.toISOString()}>{formatDateTime(m.at)}</time>
                  </div>
                </div>
              </li>
            ) : (
              <li key={m.id} className="flex flex-col items-end">
                <div className="max-w-[85%] sm:max-w-[75%]">
                  <div className="rounded-2xl rounded-br-sm bg-[#06C755] px-3 py-2 text-sm text-white shadow-sm">
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 pr-1 text-[11px] text-zinc-400">
                    {m.status !== "SENT" && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MESSAGE_STATUS_META[m.status]}`}>
                        {m.status}
                      </span>
                    )}
                    {m.via === "ai" ? (
                      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                        ✨ AI auto-reply
                      </span>
                    ) : (
                      <span className="max-w-[10rem] truncate">{ownerName}</span>
                    )}
                    <span aria-hidden="true">·</span>
                    <time dateTime={m.at.toISOString()}>{formatDateTime(m.at)}</time>
                  </div>
                </div>
              </li>
            ),
          )}
          <ChatScrollAnchor dependency={messages.length} />
        </ol>
      )}

      {/* Sits directly above the composer: a saved copilot draft, or an AI reply
          whose send failed, is the next thing the rep has to act on. */}
      {drafts && <div className="mt-3">{drafts}</div>}

      <ChatComposer leadId={leadId} aiEnabled={aiAutoReplyEnabled} lineLinked={lineLinked} optedOut={optedOut} />
    </div>
  );
}
