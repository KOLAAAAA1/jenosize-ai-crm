import type { PrismaClient, Stage } from "@prisma/client";
import { isStage } from "./crm";

export type StageMoveResult =
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
