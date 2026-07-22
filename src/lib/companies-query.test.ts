import { describe, it, expect } from "vitest";
import { buildCompanyWhere } from "./companies-query";

describe("buildCompanyWhere", () => {
  it("returns an empty clause for empty input", () => {
    expect(buildCompanyWhere({})).toEqual({});
  });

  it("keeps a known industry/size and drops unknown ones", () => {
    expect(buildCompanyWhere({ industry: "Finance", size: "51-200" })).toEqual({
      industry: "Finance",
      size: "51-200",
    });
    expect(buildCompanyWhere({ industry: "Nope", size: "9000" })).toEqual({});
  });

  it("builds a case-insensitive OR over name and website for q", () => {
    const where = buildCompanyWhere({ q: "  acme  " });
    expect(where.OR).toEqual([
      { name: { contains: "acme", mode: "insensitive" } },
      { website: { contains: "acme", mode: "insensitive" } },
    ]);
  });
});
