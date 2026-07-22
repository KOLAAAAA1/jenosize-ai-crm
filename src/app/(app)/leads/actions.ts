"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { applyStageMove } from "@/lib/leads-service";
import { approveAndSendLineDraft, saveLineDraftFromAiSuggestion } from "@/lib/line/outbound";
import type { Stage } from "@prisma/client";

export type MoveStageResult = { ok: true } | { ok: false; error: string };

export async function moveLeadStage(leadId: string, nextStage: Stage): Promise<MoveStageResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const res = await applyStageMove(prisma, { leadId, userId: user.id, nextStage });
  if (!res.ok) return { ok: false, error: res.error };

  if (res.changed) {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/board");
  }
  return { ok: true };
}

export type ReviewResult = { ok: true } | { ok: false; error: string };

// The suggestion → commit boundary: a human accepts or rejects an AiSuggestion.
// This only transitions status — it never auto-applies the suggestion (e.g. a
// recommended stage move stays a manual action), per the SKILL.md contract that
// suggestions are proposals, not instructions.
export async function reviewSuggestion(
  id: string,
  decision: "ACCEPTED" | "REJECTED",
): Promise<ReviewResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const sug = await prisma.aiSuggestion.findUnique({ where: { id }, select: { leadId: true, status: true } });
  if (!sug) return { ok: false, error: "Suggestion not found" };
  if (sug.status !== "SUGGESTED") return { ok: false, error: "Suggestion already reviewed" };

  await prisma.aiSuggestion.update({ where: { id }, data: { status: decision } });
  revalidatePath(`/leads/${sug.leadId}`);
  return { ok: true };
}

export type SaveLineDraftActionResult = { ok: true } | { ok: false; error: string };

export async function saveLineDraft(id: string): Promise<SaveLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const res = await saveLineDraftFromAiSuggestion(prisma, id, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  return { ok: true };
}

export type SendLineDraftActionResult = { ok: true } | { ok: false; error: string };

export async function approveAndSendLineMessage(messageId: string): Promise<SendLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const res = await approveAndSendLineDraft(prisma, messageId, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  return { ok: true };
}
