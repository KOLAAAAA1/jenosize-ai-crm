import { describe, it, expect } from "vitest";
import { loginSchema, companySchema, contactSchema } from "@/lib/validation";

describe("loginSchema", () => {
  it("accepts valid input and normalizes the email (trim + lowercase)", () => {
    const r = loginSchema.safeParse({ email: "  ADMIN@Jenosize.Demo ", password: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("admin@jenosize.demo");
  });

  it("rejects an invalid email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
  });
});

describe("companySchema", () => {
  it("requires a name and coerces empty optionals to undefined", () => {
    const r = companySchema.safeParse({ name: "  Acme  ", industry: "", size: "", website: "", notes: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Acme");
      expect(r.data.industry).toBeUndefined();
      expect(r.data.website).toBeUndefined();
    }
  });

  it("rejects a blank name and an unknown industry", () => {
    expect(companySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(companySchema.safeParse({ name: "X", industry: "Nope" }).success).toBe(false);
  });
});

describe("contactSchema", () => {
  it("requires companyId + firstName + lastName and defaults consent to UNKNOWN", () => {
    const r = contactSchema.safeParse({ companyId: "cmp_1", firstName: "Somchai", lastName: "Jaidee" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.consentStatus).toBe("UNKNOWN");
      expect(r.data.email).toBeUndefined();
    }
  });

  it("rejects a blank first or last name", () => {
    expect(contactSchema.safeParse({ companyId: "c", firstName: "  ", lastName: "L" }).success).toBe(false);
    expect(contactSchema.safeParse({ companyId: "c", firstName: "F", lastName: "" }).success).toBe(false);
  });

  it("normalizes a provided email and rejects a malformed one", () => {
    const ok = contactSchema.safeParse({ companyId: "c", firstName: "F", lastName: "L", email: " A@B.CO " });
    expect(ok.success && ok.data.email).toBe("a@b.co");
    expect(contactSchema.safeParse({ companyId: "c", firstName: "F", lastName: "L", email: "bad" }).success).toBe(false);
  });

  it("rejects a missing company and an invalid consent value", () => {
    expect(contactSchema.safeParse({ companyId: "", firstName: "F", lastName: "L" }).success).toBe(false);
    expect(contactSchema.safeParse({ companyId: "c", firstName: "F", lastName: "L", consentStatus: "MAYBE" }).success).toBe(false);
  });
});
