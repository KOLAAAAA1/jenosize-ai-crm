import type { PrismaClient, TaskStatus } from "@prisma/client";

// Task DB logic, separated from the server actions so it is testable without a
// request context (the actions add session checks + revalidatePath around this),
// mirroring leads-service.

export type CreateTaskInput = { leadId: string; ownerId: string; title: string; dueAt: Date | null };
export type CreateTaskResult = { ok: true; taskId: string } | { ok: false; error: string };

export async function createTaskForLead(db: PrismaClient, input: CreateTaskInput): Promise<CreateTaskResult> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Lead not found" };

  const task = await db.task.create({
    data: { leadId: input.leadId, ownerId: input.ownerId, title: input.title, dueAt: input.dueAt },
    select: { id: true },
  });
  return { ok: true, taskId: task.id };
}

export type ToggleTaskResult = { ok: true; leadId: string; status: TaskStatus } | { ok: false; error: string };

// Flip OPEN ⇄ DONE. Owner-guarded: only the task's owner can change it.
export async function toggleTask(db: PrismaClient, params: { taskId: string; userId: string }): Promise<ToggleTaskResult> {
  const task = await db.task.findUnique({
    where: { id: params.taskId },
    select: { ownerId: true, leadId: true, status: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  if (task.ownerId !== params.userId) return { ok: false, error: "You can only change your own tasks" };

  const done = task.status === "DONE";
  const next: TaskStatus = done ? "OPEN" : "DONE";
  await db.task.update({
    where: { id: params.taskId },
    data: { status: next, completedAt: done ? null : new Date() },
  });
  return { ok: true, leadId: task.leadId, status: next };
}
