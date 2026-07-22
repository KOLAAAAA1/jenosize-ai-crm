import { describe, it, expect } from "vitest";
import { buildContactWhere } from "./contacts-query";

describe("buildContactWhere", () => {
  it("returns an empty clause for empty input", () => {
    expect(buildContactWhere({})).toEqual({});
  });

  it("filters by company and valid consent, ignoring invalid consent", () => {
    expect(buildContactWhere({ companyId: "cmp_1", consent: "OPTED_OUT" })).toMatchObject({
      companyId: "cmp_1",
      consentStatus: "OPTED_OUT",
    });
    expect(buildContactWhere({ consent: "MAYBE" })).toEqual({});
  });

  it("maps line=yes/no to a lineUserId presence check", () => {
    expect(buildContactWhere({ line: "yes" })).toMatchObject({ lineUserId: { not: null } });
    expect(buildContactWhere({ line: "no" })).toMatchObject({ lineUserId: null });
    expect(buildContactWhere({ line: "whatever" }).lineUserId).toBeUndefined();
  });

  it("single-token q → one AND clause OR-ing firstName/lastName/email/phone", () => {
    const where = buildContactWhere({ q: " som " });
    expect(where.AND).toEqual([
      {
        OR: [
          { firstName: { contains: "som", mode: "insensitive" } },
          { lastName: { contains: "som", mode: "insensitive" } },
          { email: { contains: "som", mode: "insensitive" } },
          { phone: { contains: "som", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("multi-token q → one AND clause per token (full-name search works across split columns)", () => {
    const where = buildContactWhere({ q: "สมชาย ธรรมเสน" });
    expect(Array.isArray(where.AND) ? where.AND.length : 0).toBe(2);
    const clauses = where.AND as { OR: { firstName?: { contains: string } }[] }[];
    expect(clauses[0].OR[0].firstName?.contains).toBe("สมชาย");
    expect(clauses[1].OR[0].firstName?.contains).toBe("ธรรมเสน");
  });

  it("composes tokens with equality filters (company + consent + search)", () => {
    const where = buildContactWhere({ companyId: "cmp_1", consent: "OPTED_IN", q: "nok" });
    expect(where).toMatchObject({ companyId: "cmp_1", consentStatus: "OPTED_IN" });
    expect(Array.isArray(where.AND)).toBe(true);
  });
});
