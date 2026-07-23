import { describe, expect, it } from "vitest";
import {
  canAccessLead,
  canManageDirectory,
  canReassignLead,
  leadScopeFor,
} from "./access-control";

describe("CRM role policy", () => {
  const admin = { id: "admin", role: "ADMIN" as const };
  const manager = { id: "manager", role: "MANAGER" as const };
  const sales = { id: "sales", role: "SALES" as const };

  it("keeps the directory and ownership changes with managers and admins", () => {
    expect(canManageDirectory(admin)).toBe(true);
    expect(canManageDirectory(manager)).toBe(true);
    expect(canManageDirectory(sales)).toBe(false);
    expect(canReassignLead(admin)).toBe(true);
    expect(canReassignLead(manager)).toBe(true);
    expect(canReassignLead(sales)).toBe(false);
  });

  it("limits a sales user to their own leads", () => {
    expect(canAccessLead(sales, "sales")).toBe(true);
    expect(canAccessLead(sales, "other-sales")).toBe(false);
    expect(canAccessLead(manager, "other-sales")).toBe(true);
    expect(canAccessLead(admin, "other-sales")).toBe(true);
    expect(leadScopeFor(sales)).toEqual({ ownerId: "sales" });
    expect(leadScopeFor(manager)).toEqual({});
  });
});
