import type { PrismaClient } from "@prisma/client";

// Contacts that self-register via LIFF are attached to this sentinel company to
// satisfy the required `companyId` FK without letting customer-typed names spawn
// near-duplicate Company rows. A sale can re-assign the contact's company later.
export const SELF_REGISTERED_COMPANY = "LINE Self-Registered";

export type LiffRegisterInput = {
  userId: string; // verified LINE userId (from the ID token — never client-supplied)
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  consent: boolean;
};

export type LiffRegisterResult = { ok: true; contactId: string; created: boolean };

async function sentinelCompanyId(db: PrismaClient): Promise<string> {
  // Company.name is not unique, so find-or-create (not upsert).
  const existing = await db.company.findFirst({
    where: { name: SELF_REGISTERED_COMPANY },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.company.create({
    data: { name: SELF_REGISTERED_COMPANY, notes: "Auto-created for LINE LIFF self-registration." },
    select: { id: true },
  });
  return created.id;
}

// Create the contact on first registration, or update it on re-submit — keyed on
// the verified `lineUserId` so a customer can only ever write their own record.
export async function registerLiffContact(db: PrismaClient, input: LiffRegisterInput): Promise<LiffRegisterResult> {
  const consentStatus = input.consent ? "OPTED_IN" : "UNKNOWN";
  const existing = await db.contact.findUnique({
    where: { lineUserId: input.userId },
    select: { id: true },
  });

  if (existing) {
    await db.contact.update({
      where: { id: existing.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        consentStatus,
      },
    });
    return { ok: true, contactId: existing.id, created: false };
  }

  const companyId = await sentinelCompanyId(db);
  const created = await db.contact.create({
    data: {
      companyId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      lineUserId: input.userId,
      consentStatus,
    },
    select: { id: true },
  });
  return { ok: true, contactId: created.id, created: true };
}
