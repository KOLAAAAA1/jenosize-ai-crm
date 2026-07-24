"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { canAccessLead, canReassignLead } from "@/lib/access-control";
import { applyStageMove, assignLeadOwner, updateLeadDealFields } from "@/lib/leads-service";
import { createTaskForLead, toggleTask } from "@/lib/tasks-service";
import { approveAndSendLineDraft, saveLineDraftFromAiSuggestion, saveLineDraftManual } from "@/lib/line/outbound";
import { approveAndSendEmailDraft, saveEmailDraft as persistEmailDraft } from "@/lib/email/outbound";
import {
  crmEntityIdSchema,
  dealFieldsSchema,
  emailDraftSchema,
  leadAssignmentSchema,
  lineDraftSchema,
  stageMoveSchema,
  suggestionReviewSchema,
  taskSchema,
} from "@/lib/validation";
import type { Stage } from "@prisma/client";

async function leadAccess(user: SessionUser, leadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (!canAccessLead(user, lead.ownerId)) return { ok: false, error: "Forbidden" };
  return { ok: true };
}

export type MoveStageResult = { ok: true } | { ok: false; error: string };

export async function moveLeadStage(leadId: string, nextStage: Stage): Promise<MoveStageResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = stageMoveSchema.safeParse({ leadId, nextStage });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid stage move" };
  leadId = parsed.data.leadId;
  nextStage = parsed.data.nextStage;

  const access = await leadAccess(user, leadId);
  if (!access.ok) return access;

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

  const parsed = suggestionReviewSchema.safeParse({ id, decision });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid review" };
  id = parsed.data.id;
  decision = parsed.data.decision;

  const sug = await prisma.aiSuggestion.findUnique({
    where: { id },
    select: { leadId: true, status: true, lead: { select: { ownerId: true } } },
  });
  if (!sug) return { ok: false, error: "Suggestion not found" };
  if (!canAccessLead(user, sug.lead.ownerId)) return { ok: false, error: "Forbidden" };
  if (sug.status !== "SUGGESTED") return { ok: false, error: "Suggestion already reviewed" };

  await prisma.aiSuggestion.update({ where: { id }, data: { status: decision } });
  revalidatePath(`/leads/${sug.leadId}`);
  return { ok: true };
}

export type SaveLineDraftActionResult = { ok: true } | { ok: false; error: string };

export async function saveLineDraft(id: string): Promise<SaveLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid suggestion id" };
  id = parsedId.data;

  const suggestion = await prisma.aiSuggestion.findUnique({
    where: { id },
    select: { lead: { select: { ownerId: true } } },
  });
  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (!canAccessLead(user, suggestion.lead.ownerId)) return { ok: false, error: "Forbidden" };

  const res = await saveLineDraftFromAiSuggestion(prisma, id, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  return { ok: true };
}

// Manual compose (Block 9): a rep writes a LINE reply → Message(DRAFT), which then
// flows through the existing approve→send path. Owner/manager-guarded.
export async function createLineDraft(leadId: string, body: string): Promise<SaveLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedId.data;

  const parsed = lineDraftSchema.safeParse({ body });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (!canAccessLead(user, lead.ownerId)) return { ok: false, error: "Forbidden" };

  const res = await saveLineDraftManual(prisma, leadId, parsed.data.body, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  return { ok: true };
}

export type SendLineDraftActionResult = { ok: true } | { ok: false; error: string };

export async function approveAndSendLineMessage(messageId: string): Promise<SendLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(messageId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid message id" };
  messageId = parsedId.data;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { lead: { select: { ownerId: true } } },
  });
  if (!message) return { ok: false, error: "Message not found" };
  if (!message.lead || !canAccessLead(user, message.lead.ownerId)) return { ok: false, error: "Forbidden" };

  const res = await approveAndSendLineDraft(prisma, messageId, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  return { ok: true };
}

export type EmailDraftActionResult = { ok: true } | { ok: false; error: string };

// Email follows the same human approval boundary as LINE: composing creates an
// auditable draft; a distinct action is required before the gateway is called.
export async function saveLeadEmailDraft(
  leadId: string,
  input: { subject: string; body: string },
): Promise<EmailDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedLeadId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedLeadId.success) return { ok: false, error: parsedLeadId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedLeadId.data;

  const access = await leadAccess(user, leadId);
  if (!access.ok) return access;

  const parsed = emailDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email draft" };

  const result = await persistEmailDraft(prisma, { leadId, userId: user.id, ...parsed.data });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function approveAndSendEmailMessage(messageId: string): Promise<EmailDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(messageId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid message id" };
  messageId = parsedId.data;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { lead: { select: { ownerId: true } } },
  });
  if (!message) return { ok: false, error: "Message not found" };
  if (!message.lead || !canAccessLead(user, message.lead.ownerId)) return { ok: false, error: "Forbidden" };

  const result = await approveAndSendEmailDraft(prisma, messageId, user.id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/leads/${result.leadId}`);
  return { ok: true };
}

export type TaskActionResult = { ok: true } | { ok: false; error: string };

// Create a follow-up task on a lead. Owner = current session user (no assigning
// to others in this slice — PLAN §11.2 scope cap).
export async function createTask(leadId: string, input: { title: string; dueAt?: string }): Promise<TaskActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedLeadId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedLeadId.success) return { ok: false, error: parsedLeadId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedLeadId.data;

  const access = await leadAccess(user, leadId);
  if (!access.ok) return access;

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
  }

  const res = await createTaskForLead(prisma, {
    leadId,
    ownerId: user.id,
    title: parsed.data.title,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/tasks");
  return { ok: true };
}

// Managers and admins assign a lead manually. Routing automation is explicitly
// deferred until the team confirms its distribution rules.
export async function changeLeadOwner(leadId: string, ownerId: string): Promise<TaskActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (!canReassignLead(user)) return { ok: false, error: "Forbidden" };

  const parsedLeadId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedLeadId.success) return { ok: false, error: parsedLeadId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedLeadId.data;

  const parsed = leadAssignmentSchema.safeParse({ ownerId });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid owner" };

  const res = await assignLeadOwner(prisma, { leadId, userId: user.id, nextOwnerId: parsed.data.ownerId });
  if (!res.ok) return { ok: false, error: res.error };

  if (res.changed) {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/board");
  }
  return { ok: true };
}

// Probability and expected close date are intentionally a thin forecasting
// surface. Both managers and the assigned sales rep may keep them current.
export async function saveLeadDealFields(
  leadId: string,
  input: { probability: number | null; expectedCloseAt: string | null },
): Promise<TaskActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedLeadId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedLeadId.success) return { ok: false, error: parsedLeadId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedLeadId.data;

  const access = await leadAccess(user, leadId);
  if (!access.ok) return access;

  const parsed = dealFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid deal fields" };

  const expectedCloseAt = parsed.data.expectedCloseAt ? new Date(parsed.data.expectedCloseAt) : null;
  const res = await updateLeadDealFields(prisma, {
    leadId,
    userId: user.id,
    probability: parsed.data.probability,
    expectedCloseAt,
  });
  if (!res.ok) return { ok: false, error: res.error };

  if (res.changed) {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/board");
  }
  return { ok: true };
}

// Flip a task OPEN ⇄ DONE. Guarded so a user can only toggle their own tasks.
export async function toggleTaskDone(taskId: string): Promise<TaskActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(taskId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid task id" };
  taskId = parsedId.data;

  const res = await toggleTask(prisma, { taskId, userId: user.id });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/leads/${res.leadId}`);
  revalidatePath("/tasks");
  return { ok: true };
}
