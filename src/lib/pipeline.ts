import type { Stage } from "@prisma/client";
import { STAGES } from "./crm";

// Minimal, serialisable projection of a Lead for the pipeline board. Kept flat
// (no Prisma relations) so the client component receives plain JSON and the
// grouping below is a pure function over it.
export type BoardLead = {
  id: string;
  title: string;
  companyName: string;
  contactName: string;
  ownerName: string;
  valueTHB: number;
  score: number | null;
  stage: Stage;
};

export type StageColumn = {
  stage: Stage;
  leads: BoardLead[];
  count: number;
  totalValue: number;
};

// Pure: partition a flat lead array into the five ordered pipeline columns.
// Every stage yields a column (even when empty) so the board always renders all
// lanes, and per-column count/value totals are computed here rather than in JSX.
// Incoming order is preserved within each column (callers sort upstream).
export function groupLeadsByStage(leads: BoardLead[]): StageColumn[] {
  return STAGES.map((stage) => {
    const columnLeads = leads.filter((l) => l.stage === stage);
    return {
      stage,
      leads: columnLeads,
      count: columnLeads.length,
      totalValue: columnLeads.reduce((sum, l) => sum + l.valueTHB, 0),
    };
  });
}
