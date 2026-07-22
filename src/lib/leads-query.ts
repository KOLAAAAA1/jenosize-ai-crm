import type { Prisma } from "@prisma/client";
import { isSource, isStage } from "./crm";

export type LeadFilterInput = {
  q?: string;
  stage?: string;
  source?: string;
  ownerId?: string;
};

// Pure builder: raw (untrusted) filter params → a validated Prisma where clause.
// Invalid stage/source values are ignored rather than throwing.
export function buildLeadWhere(input: LeadFilterInput): Prisma.LeadWhereInput {
  const q = input.q?.trim();
  const stage = isStage(input.stage) ? input.stage : undefined;
  const source = isSource(input.source) ? input.source : undefined;
  const ownerId = input.ownerId?.trim() || undefined;

  return {
    ...(stage ? { stage } : {}),
    ...(source ? { source } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { company: { is: { name: { contains: q, mode: "insensitive" } } } },
            { contact: { is: { firstName: { contains: q, mode: "insensitive" } } } },
            { contact: { is: { lastName: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}
