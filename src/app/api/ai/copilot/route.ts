import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { leadScopeFor } from "@/lib/access-control";
import { buildCopilotContext } from "@/lib/ai/context";
import { generateSuggestion } from "@/lib/ai/copilot";
import { crmEntityIdSchema } from "@/lib/validation";

// The copilot may call the Anthropic SDK (Node APIs) — force the Node runtime.
export const runtime = "nodejs";

// POST /api/ai/copilot { leadId } → runs the copilot for one lead, persists the
// result as an AiSuggestion(SUGGESTED), and returns it. Degrades to the
// deterministic fallback automatically when the model is unavailable / unkeyed.
export async function POST(req: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user; // 401 for unauthenticated API callers

  const body = await req.json().catch(() => null);
  const leadId = crmEntityIdSchema.safeParse(body?.leadId);
  if (!leadId.success) return NextResponse.json({ error: leadId.error.issues[0]?.message ?? "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId.data, ...leadScopeFor(user) },
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
      leadId: leadId.data,
      type: "SUMMARY",
      payload: suggestion,
      model: suggestion.model,
      status: "SUGGESTED",
      createdBy: suggestion.source === "ai" ? `ai:${suggestion.model}` : "fallback:deterministic",
    },
  });

  revalidatePath(`/leads/${leadId.data}`);
  return NextResponse.json({ id: row.id, suggestion });
}
