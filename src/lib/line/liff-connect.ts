import type { PrismaClient } from "@prisma/client";
import { SELF_REGISTERED_COMPANY } from "./liff-register";

// Binds a *verified* LINE user to a *specific* existing Contact (the one carried
// in the officer-minted link token). Complements liff-register.ts, which instead
// creates a brand-new sentinel contact for a walk-up first-time registrant.

export type LiffConnectInput = {
  lineUserId: string; // verified from the LIFF ID token — never client-supplied
  contactId: string; // from the signed link token — never a plain client param
  consent: boolean; // one-tap PDPA confirm on the link screen
};

export type LiffConnectResult =
  | { ok: true; contactId: string; outcome: "linked" | "already_linked" | "relinked_from_sentinel" }
  | { ok: false; reason: "contact_not_found" | "line_linked_to_other" | "contact_already_linked" };

// Handles the four cases:
//  - lineUserId free                          → link it to the target contact
//  - already on the target contact            → idempotent success
//  - already on a *sentinel* self-registered  → relink: move its messages to the
//    contact with no leads                       target, delete the sentinel, link
//  - already on any other (real) contact      → reject (merge is out of scope)
export async function connectLineUserToContact(db: PrismaClient, input: LiffConnectInput): Promise<LiffConnectResult> {
  const consentStatus = input.consent ? "OPTED_IN" : "UNKNOWN";

  const target = await db.contact.findUnique({ where: { id: input.contactId }, select: { id: true, lineUserId: true } });
  if (!target) return { ok: false, reason: "contact_not_found" };

  // The link token is replayable within its TTL; never let a *different* LINE user
  // overwrite a contact that is already linked. Same user re-opening is idempotent.
  if (target.lineUserId) {
    if (target.lineUserId === input.lineUserId) {
      await db.contact.update({ where: { id: input.contactId }, data: { consentStatus } });
      return { ok: true, contactId: input.contactId, outcome: "already_linked" };
    }
    return { ok: false, reason: "contact_already_linked" };
  }

  const existing = await db.contact.findUnique({
    where: { lineUserId: input.lineUserId },
    select: { id: true, company: { select: { name: true } }, _count: { select: { leads: true } } },
  });

  // Target is unlinked (checked above). If this LINE user is free too → straight link.
  if (!existing) {
    await db.contact.update({ where: { id: input.contactId }, data: { lineUserId: input.lineUserId, consentStatus } });
    return { ok: true, contactId: input.contactId, outcome: "linked" };
  }

  // On a leadless sentinel self-registration → safe to fold into the real contact:
  // move its LINE messages over, drop the sentinel, then link. (A sentinel that has
  // grown leads, or any real contact, is a genuine conflict — merging those is out
  // of scope for this slice; §11.9 defers full contact-merge tooling.)
  const isFoldableSentinel = existing.company.name === SELF_REGISTERED_COMPANY && existing._count.leads === 0;
  if (isFoldableSentinel) {
    await db.$transaction(async (tx) => {
      await tx.message.updateMany({ where: { contactId: existing.id }, data: { contactId: input.contactId } });
      await tx.contact.delete({ where: { id: existing.id } }); // frees the @unique lineUserId
      await tx.contact.update({ where: { id: input.contactId }, data: { lineUserId: input.lineUserId, consentStatus } });
    });
    return { ok: true, contactId: input.contactId, outcome: "relinked_from_sentinel" };
  }

  return { ok: false, reason: "line_linked_to_other" };
}
