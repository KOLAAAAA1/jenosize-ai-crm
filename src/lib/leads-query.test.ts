import { describe, it, expect } from "vitest";
import { buildLeadWhere } from "@/lib/leads-query";

describe("buildLeadWhere", () => {
  it("returns an empty where for empty input", () => {
    expect(buildLeadWhere({})).toEqual({});
  });

  it("passes through valid stage / source / owner", () => {
    expect(buildLeadWhere({ stage: "QUALIFIED", source: "LINE_OA", ownerId: "usr_1" })).toEqual({
      stage: "QUALIFIED",
      source: "LINE_OA",
      ownerId: "usr_1",
    });
  });

  it("ignores invalid stage / source values", () => {
    expect(buildLeadWhere({ stage: "BOGUS", source: "NOPE" })).toEqual({});
  });

  it("builds an OR across title, company, and contact for search text", () => {
    const where = buildLeadWhere({ q: "acme" });
    expect(where.OR).toEqual([
      { title: { contains: "acme", mode: "insensitive" } },
      { company: { is: { name: { contains: "acme", mode: "insensitive" } } } },
      { contact: { is: { firstName: { contains: "acme", mode: "insensitive" } } } },
      { contact: { is: { lastName: { contains: "acme", mode: "insensitive" } } } },
    ]);
  });

  it("trims whitespace-only search to nothing", () => {
    expect(buildLeadWhere({ q: "   " })).toEqual({});
  });

  it("combines filters and search", () => {
    const where = buildLeadWhere({ q: "co", stage: "WON" });
    expect(where.stage).toBe("WON");
    // title + company + contact.firstName + contact.lastName
    expect(where.OR).toHaveLength(4);
  });
});
