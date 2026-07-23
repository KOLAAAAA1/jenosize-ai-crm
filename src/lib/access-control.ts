import type { UserRole } from "@prisma/client";

// The JWT is the authenticated principal for the request. These small pure
// helpers keep the role matrix consistent between pages, Server Actions, and
// Route Handlers; callers still query the target row before mutating it.
export type CrmPrincipal = { id: string; role: UserRole };

export function canManageDirectory(user: Pick<CrmPrincipal, "role">): boolean {
  return user.role === "ADMIN" || user.role === "MANAGER";
}

export function canReassignLead(user: Pick<CrmPrincipal, "role">): boolean {
  return canManageDirectory(user);
}

export function canAccessLead(user: CrmPrincipal, ownerId: string): boolean {
  return canManageDirectory(user) || ownerId === user.id;
}

// A Prisma-ready scope for all lead reads. Admins/managers can see the shared
// queue; a sales representative sees only their assigned records.
export function leadScopeFor(user: CrmPrincipal): { ownerId?: string } {
  return canManageDirectory(user) ? {} : { ownerId: user.id };
}
