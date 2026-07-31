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
import { copilotResultSchema, clampScore } from "@/lib/ai/schema";
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
// Accepting is the approval that applies the suggestion's qualification *score* to
// the lead (with an audit Activity). The recommended STAGE deliberately stays a
// manual move, per the SKILL.md contract that suggestions are proposals — but the
// score is an AI/rule-derived metric the accept is meant to commit.
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
    select: { leadId: true, status: true, payload: true, lead: { select: { ownerId: true } } },
  });
  if (!sug) return { ok: false, error: "Suggestion not found" };
  if (!canAccessLead(user, sug.lead.ownerId)) return { ok: false, error: "Forbidden" };
  if (sug.status !== "SUGGESTED") return { ok: false, error: "Suggestion already reviewed" };

  // On accept, write the suggested score (+ reasons) onto the lead and log it.
  if (decision === "ACCEPTED") {
    const scored = copilotResultSchema.safeParse(sug.payload);
    const nextScore = scored.success ? clampScore(scored.data.qualification.score) : null;
    if (scored.success && nextScore != null) {
      const reason = scored.data.qualification.reasons.join(" · ") || scored.data.summary.overview;
      await prisma.$transaction([
        prisma.aiSuggestion.update({ where: { id }, data: { status: decision } }),
        prisma.lead.update({ where: { id: sug.leadId }, data: { score: nextScore, scoreReason: reason } }),
        prisma.activity.create({
          data: {
            leadId: sug.leadId,
            userId: user.id,
            type: "AI_SUGGESTION",
            body: `AI qualification score applied: ${nextScore}.`,
            metadata: { kind: "AI_SCORE_APPLIED", score: nextScore, suggestionId: id },
          },
        }),
      ]);
      revalidatePath(`/leads/${sug.leadId}`);
      return { ok: true };
    }
  }

  // Reject, or accept a suggestion with no usable score → status transition only.
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

// The manual half of the chat box: a rep types a reply and sends it in one action,
// which is only reachable while AI auto-reply is switched OFF for the contact.
//
// It is still the audited two-step underneath — saveLineDraftManual writes the
// Message(DRAFT) + Activity, then approveAndSendLineDraft performs the send with its
// retry-key idempotency and OPTED_OUT checks. Sending a chat message *is* the human
// approval here, so the two steps are collapsed into one click rather than skipped.
export async function sendLineChatMessage(leadId: string, body: string): Promise<SendLineDraftActionResult> {
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

  const draft = await saveLineDraftManual(prisma, leadId, parsed.data.body, user.id);
  if (!draft.ok) return { ok: false, error: draft.error };

  const sent = await approveAndSendLineDraft(prisma, draft.messageId, user.id);
  revalidatePath(`/leads/${leadId}`);
  // The draft survives a failed send as a FAILED row in the LINE drafts panel, so
  // the text is never lost — the rep can retry from there.
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}

// The AI auto-reply switch, as flipped from the lead's chat box. Stored on the
// Contact (the OA talks to a person, not to a deal), but authorised by LEAD access
// so the assigned sales rep can use it — `setContactAutoReply` on the contact page
// is admin/manager-only and would lock reps out of their own conversations.
export async function setLeadAiAutoReply(leadId: string, enabled: boolean): Promise<SendLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(leadId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid lead id" };
  leadId = parsedId.data;
  if (typeof enabled !== "boolean") return { ok: false, error: "Invalid switch value" };

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true, contactId: true } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (!canAccessLead(user, lead.ownerId)) return { ok: false, error: "Forbidden" };

  try {
    await prisma.contact.update({ where: { id: lead.contactId }, data: { autoReplyEnabled: enabled } });
  } catch {
    return { ok: false, error: "Could not update AI auto-reply." };
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/contacts/${lead.contactId}`);
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

// Discard an unsent LINE draft (DRAFT or FAILED). Sent messages are immutable
// timeline records and cannot be deleted here — only outbound drafts that never
// went out. Owner/manager-guarded like the send path.
export async function deleteLineDraft(messageId: string): Promise<SendLineDraftActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsedId = crmEntityIdSchema.safeParse(messageId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid message id" };
  messageId = parsedId.data;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { status: true, channel: true, direction: true, leadId: true, lead: { select: { ownerId: true } } },
  });
  if (!message) return { ok: false, error: "Message not found" };
  if (!message.lead || !canAccessLead(user, message.lead.ownerId)) return { ok: false, error: "Forbidden" };
  if (message.channel !== "LINE" || message.direction !== "OUT" || (message.status !== "DRAFT" && message.status !== "FAILED")) {
    return { ok: false, error: "Only unsent LINE drafts can be deleted" };
  }

  await prisma.message.delete({ where: { id: messageId } });
  if (message.leadId) revalidatePath(`/leads/${message.leadId}`);
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
  input: { valueTHB: number; probability: number | null; expectedCloseAt: string | null },
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
    valueTHB: parsed.data.valueTHB,
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
