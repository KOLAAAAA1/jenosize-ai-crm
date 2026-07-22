import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { buildCopilotContext } from "@/lib/ai/context";
import { generateSuggestion } from "@/lib/ai/copilot";

// The copilot may call the Anthropic SDK (Node APIs) — force the Node runtime.
export const runtime = "nodejs";

// POST /api/ai/copilot { leadId } → runs the copilot for one lead, persists the
// result as an AiSuggestion(SUGGESTED), and returns it. Degrades to the
// deterministic fallback automatically when the model is unavailable / unkeyed.
export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user; // 401 for unauthenticated API callers

  const body = await req.json().catch(() => null);
  const leadId = typeof body?.leadId === "string" ? body.leadId : null;
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      company: true,
      contact: true,
      owner: true,
      activities: { orderBy: { createdAt: "desc" }, take: 10 },
      messages: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const ctx = buildCopilotContext(lead);
  const suggestion = await generateSuggestion(ctx);

  const row = await prisma.aiSuggestion.create({
    data: {
      leadId,
      type: "SUMMARY",
      payload: suggestion,
      model: suggestion.model,
      status: "SUGGESTED",
      createdBy: suggestion.source === "ai" ? `ai:${suggestion.model}` : "fallback:deterministic",
    },
  });

  revalidatePath(`/leads/${leadId}`);
  return NextResponse.json({ id: row.id, suggestion });
}
