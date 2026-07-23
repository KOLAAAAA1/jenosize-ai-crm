import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ACTIVITY_META, MESSAGE_STATUS_META, SOURCE_META, STAGE_META, messageDirectionLabel, contactName } from "@/lib/crm";
import { formatDateTime, formatTHB, timeAgo } from "@/lib/format";
import { StageMover } from "./stage-mover";
import { CopilotPanel, type PendingSuggestion } from "./copilot-panel";
import { LineDraftsPanel, type PendingLineDraft } from "./line-drafts-panel";
import { ChatHistory, type ChatMessage } from "./chat-history";
import { copilotResultSchema, type CopilotSuggestion } from "@/lib/ai/schema";

type TimelineItem =
  | { kind: "activity"; at: Date; id: string; type: keyof typeof ACTIVITY_META; body: string; actor: string | null }
  | { kind: "message"; at: Date; id: string; direction: "IN" | "OUT"; status: keyof typeof MESSAGE_STATUS_META; body: string };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      company: true,
      contact: true,
      owner: true,
      activities: { include: { user: true }, orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "desc" } },
      suggestions: { where: { status: "SUGGESTED" }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead) notFound();

  // Only render suggestions whose payload matches the current copilot schema —
  // legacy/malformed payloads are skipped rather than crashing the whole page.
  const pendingSuggestions: PendingSuggestion[] = lead.suggestions.flatMap((s) =>
    copilotResultSchema.safeParse(s.payload).success
      ? [{ id: s.id, createdBy: s.createdBy, payload: s.payload as unknown as CopilotSuggestion }]
      : [],
  );

  const pendingLineDrafts: PendingLineDraft[] = lead.messages
    .filter((m) => m.direction === "OUT" && (m.status === "DRAFT" || m.status === "FAILED"))
    .map((m) => ({ id: m.id, body: m.body, status: m.status as "DRAFT" | "FAILED" }));

  // LINE conversation as a chat thread (oldest → newest) — handover evidence.
  const chatMessages: ChatMessage[] = lead.messages
    .filter((m) => m.channel === "LINE")
    .map((m) => ({ id: m.id, direction: m.direction, status: m.status, body: m.body, at: m.createdAt }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const timeline: TimelineItem[] = [
    ...lead.activities.map((a) => ({
      kind: "activity" as const,
      at: a.createdAt,
      id: a.id,
      type: a.type,
      body: a.body,
      actor: a.user?.name ?? null,
    })),
    ...lead.messages.map((m) => ({
      kind: "message" as const,
      at: m.createdAt,
      id: m.id,
      direction: m.direction,
      status: m.status,
      body: m.body,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const profile: { label: string; value: string }[] = [
    { label: "Company", value: lead.company.name },
    { label: "Contact", value: contactName(lead.contact) },
    { label: "Contact title", value: lead.contact.title ?? "—" },
    { label: "Owner", value: lead.owner.name },
    { label: "Source", value: SOURCE_META[lead.source] },
    { label: "Value", value: formatTHB(lead.valueTHB) },
    { label: "Score", value: lead.score != null ? String(lead.score) : "Not scored" },
    { label: "Created", value: formatDateTime(lead.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/leads" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Leads</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{lead.title}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {lead.company.name} · {contactName(lead.contact)}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_META[lead.stage].badge}`}>
              {STAGE_META[lead.stage].label}
            </span>
            <StageMover leadId={lead.id} current={lead.stage} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile */}
        <section className="lg:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Profile</h2>
            <dl className="flex flex-col gap-3">
              {profile.map((row) => (
                <div key={row.label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-zinc-500 dark:text-zinc-400">{row.label}</dt>
                  <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{row.value}</dd>
                </div>
              ))}
            </dl>
            {lead.scoreReason && (
              <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                <span className="font-semibold">Score reason:</span> {lead.scoreReason}
              </p>
            )}
          </div>

          <div className="mt-4">
            <CopilotPanel leadId={lead.id} suggestions={pendingSuggestions} />
          </div>

          <div className="mt-4">
            <LineDraftsPanel drafts={pendingLineDrafts} />
          </div>
        </section>

        {/* Conversation + Timeline */}
        <section className="lg:col-span-2 flex flex-col gap-6">
          <ChatHistory messages={chatMessages} contactName={contactName(lead.contact)} ownerName={lead.owner.name} />

          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Timeline · {timeline.length}
            </h2>
            <ol className="flex flex-col gap-4">
              {timeline.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {item.kind === "activity" ? ACTIVITY_META[item.type].icon : item.direction === "IN" ? "↙" : "↗"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {item.kind === "activity"
                          ? ACTIVITY_META[item.type].label
                          : `LINE · ${messageDirectionLabel(item.direction)}`}
                        {item.kind === "activity" && item.actor ? (
                          <span className="font-normal text-zinc-400"> · {item.actor}</span>
                        ) : null}
                      </span>
                      <time className="flex-none text-xs tabular-nums text-zinc-400" dateTime={item.at.toISOString()} title={formatDateTime(item.at)}>
                        {timeAgo(item.at)}
                      </time>
                    </div>
                    <p className="mt-0.5 break-words text-sm text-zinc-600 dark:text-zinc-400">{item.body}</p>
                    {item.kind === "message" && (
                      <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${MESSAGE_STATUS_META[item.status]}`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                </li>
              ))}
              {timeline.length === 0 && (
                <li className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No activity yet.</li>
              )}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
