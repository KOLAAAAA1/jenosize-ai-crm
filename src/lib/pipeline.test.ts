import { describe, it, expect } from "vitest";
import { groupLeadsByStage, type BoardLead } from "./pipeline";
import { STAGES } from "./crm";

function lead(id: string, stage: BoardLead["stage"], valueTHB = 0): BoardLead {
  return {
    id,
    title: `Lead ${id}`,
    companyName: "Acme",
    contactName: "Contact",
    ownerName: "Owner",
    valueTHB,
    score: null,
    stage,
  };
}

describe("groupLeadsByStage", () => {
  it("always returns all five stage columns in canonical order", () => {
    const cols = groupLeadsByStage([]);
    expect(cols.map((c) => c.stage)).toEqual([...STAGES]);
    expect(cols.every((c) => c.count === 0 && c.totalValue === 0)).toBe(true);
  });

  it("partitions leads into their stage and sums value per column", () => {
    const cols = groupLeadsByStage([
      lead("a", "NEW", 100),
      lead("b", "NEW", 250),
      lead("c", "WON", 900),
    ]);
    const byStage = Object.fromEntries(cols.map((c) => [c.stage, c]));
    expect(byStage.NEW.count).toBe(2);
    expect(byStage.NEW.totalValue).toBe(350);
    expect(byStage.NEW.leads.map((l) => l.id)).toEqual(["a", "b"]);
    expect(byStage.WON.count).toBe(1);
    expect(byStage.WON.totalValue).toBe(900);
    expect(byStage.QUALIFIED.count).toBe(0);
  });

  it("preserves incoming order within a column", () => {
    const cols = groupLeadsByStage([lead("z", "NEW"), lead("a", "NEW"), lead("m", "NEW")]);
    expect(cols[0].leads.map((l) => l.id)).toEqual(["z", "a", "m"]);
  });
});
