import { describe, it, expect } from "vitest";
import { isStage, isSource, STAGES, SOURCES, STAGE_META, SOURCE_META } from "@/lib/crm";

describe("isStage", () => {
  it("accepts valid stages", () => expect(isStage("QUALIFIED")).toBe(true));
  it("rejects invalid / undefined", () => {
    expect(isStage("BOGUS")).toBe(false);
    expect(isStage(undefined)).toBe(false);
    expect(isStage("qualified")).toBe(false); // case-sensitive
  });
});

describe("isSource", () => {
  it("accepts valid sources", () => expect(isSource("LINE_OA")).toBe(true));
  it("rejects invalid", () => expect(isSource("EMAIL")).toBe(false));
});

describe("display metadata completeness", () => {
  it("STAGE_META covers every stage", () => {
    for (const s of STAGES) expect(STAGE_META[s]?.label).toBeTruthy();
  });
  it("SOURCE_META covers every source", () => {
    for (const s of SOURCES) expect(SOURCE_META[s]).toBeTruthy();
  });
});
