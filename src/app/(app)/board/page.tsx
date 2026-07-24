import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { leadScopeFor } from "@/lib/access-control";
import { contactName } from "@/lib/crm";
import type { BoardLead } from "@/lib/pipeline";
import { PipelineBoard } from "./pipeline-board";

// Cap the board payload. The seed holds ~300 leads; a Kanban with every card is
// fine, but this bounds the query so the page stays responsive if the dataset
// grows. Most-recently-updated leads win the cap.
const BOARD_LIMIT = 500;

export default async function BoardPage() {
  const user = await requireUser();
  const rows = await prisma.lead.findMany({
    where: leadScopeFor(user),
    orderBy: { updatedAt: "desc" },
    take: BOARD_LIMIT,
    select: {
      id: true,
      title: true,
      stage: true,
      valueTHB: true,
      score: true,
      company: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
      owner: { select: { name: true } },
    },
  });

  const leads: BoardLead[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    stage: r.stage,
    valueTHB: r.valueTHB,
    score: r.score,
    companyName: r.company.name,
    contactName: contactName(r.contact),
    ownerName: r.owner.name,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Pipeline</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="lg:hidden">Swipe across stages, then use Move to on a card to update it. </span>
          <span className="hidden lg:inline">Drag a lead between stages to update it. </span>
          {leads.length.toLocaleString()} lead
          {leads.length === 1 ? "" : "s"} shown.
        </p>
      </div>

      <PipelineBoard leads={leads} />
    </div>
  );
}
