import type { PrismaClient, Stage } from "@prisma/client";
import { isStage } from "./crm";

export type StageMoveResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export type DealFieldsResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export type LeadAssignmentResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

// Core stage-move mutation, decoupled from auth/Next so it can be integration-
// tested directly. Updates the lead and appends an immutable STAGE_CHANGE
// activity atomically. Auth + cache revalidation are the caller's responsibility.
export async function applyStageMove(
  db: PrismaClient,
  args: { leadId: string; userId: string | null; nextStage: Stage },
): Promise<StageMoveResult> {
  if (!isStage(args.nextStage)) return { ok: false, error: "Invalid stage" };

  const lead = await db.lead.findUnique({ where: { id: args.leadId }, select: { stage: true } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (lead.stage === args.nextStage) return { ok: true, changed: false };

  await db.$transaction([
    db.lead.update({ where: { id: args.leadId }, data: { stage: args.nextStage } }),
    db.activity.create({
      data: {
        leadId: args.leadId,
        userId: args.userId,
        type: "STAGE_CHANGE",
        body: `Stage changed from ${lead.stage} to ${args.nextStage}.`,
        metadata: { from: lead.stage, to: args.nextStage },
      },
    }),
  ]);

  return { ok: true, changed: true };
}

// Mutates the small forecasting surface without turning it into a separate
// quoting module. Every meaningful edit appends to the immutable timeline.
export async function updateLeadDealFields(
  db: PrismaClient,
  args: {
    leadId: string;
    userId: string;
    probability: number | null;
    expectedCloseAt: Date | null;
  },
): Promise<DealFieldsResult> {
  const lead = await db.lead.findUnique({
    where: { id: args.leadId },
    select: { probability: true, expectedCloseAt: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };

  const sameProbability = lead.probability === args.probability;
  const sameDate = lead.expectedCloseAt?.getTime() === args.expectedCloseAt?.getTime();
  if (sameProbability && sameDate) return { ok: true, changed: false };

  await db.$transaction([
    db.lead.update({
      where: { id: args.leadId },
      data: { probability: args.probability, expectedCloseAt: args.expectedCloseAt },
    }),
    db.activity.create({
      data: {
        leadId: args.leadId,
        userId: args.userId,
        type: "NOTE",
        body: "Deal details updated.",
        metadata: {
          kind: "DEAL_FIELDS_UPDATED",
          from: {
            probability: lead.probability,
            expectedCloseAt: lead.expectedCloseAt?.toISOString() ?? null,
          },
          to: {
            probability: args.probability,
            expectedCloseAt: args.expectedCloseAt?.toISOString() ?? null,
          },
        },
      },
    }),
  ]);

  return { ok: true, changed: true };
}

// Manual ownership transfer is deliberately the first routing increment. A
// manager/admin chooses an active rep; automatic round-robin/territory logic
// remains a later product decision rather than hidden behavior.
export async function assignLeadOwner(
  db: PrismaClient,
  args: { leadId: string; userId: string; nextOwnerId: string },
): Promise<LeadAssignmentResult> {
  const [lead, nextOwner] = await Promise.all([
    db.lead.findUnique({
      where: { id: args.leadId },
      include: { owner: { select: { id: true, name: true } } },
    }),
    db.user.findUnique({ where: { id: args.nextOwnerId }, select: { id: true, name: true, role: true } }),
  ]);

  if (!lead) return { ok: false, error: "Lead not found" };
  if (!nextOwner || nextOwner.role === "ADMIN") return { ok: false, error: "Select an active sales or manager user" };
  if (lead.ownerId === nextOwner.id) return { ok: true, changed: false };

  await db.$transaction([
    db.lead.update({ where: { id: args.leadId }, data: { ownerId: nextOwner.id } }),
    db.activity.create({
      data: {
        leadId: args.leadId,
        userId: args.userId,
        type: "NOTE",
        body: `Lead owner changed from ${lead.owner.name} to ${nextOwner.name}.`,
        metadata: {
          kind: "LEAD_OWNER_CHANGED",
          fromOwnerId: lead.owner.id,
          toOwnerId: nextOwner.id,
        },
      },
    }),
  ]);

  return { ok: true, changed: true };
}
