"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type ConsentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canManageDirectory } from "@/lib/access-control";
import { autoReplyToggleSchema, contactSchema, crmEntityIdSchema } from "@/lib/validation";
import { signContactLinkToken } from "@/lib/line/link-token";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function firstErrors(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldErrors)) if (v?.[0]) out[k] = v[0];
  return out;
}

// Create (id === null) or update a contact. Zod-validated. A duplicate LINE user
// id (the one unique column) is surfaced as a field error rather than a crash.
export async function saveContact(id: string | null, formData: FormData): Promise<SaveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (!canManageDirectory(user)) return { ok: false, error: "Forbidden" };

  if (id) {
    const parsedId = crmEntityIdSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid contact id" };
    id = parsedId.data;
  }

  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: firstErrors(parsed.error.flatten().fieldErrors) };
  }

  const data = {
    companyId: parsed.data.companyId,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    title: parsed.data.title ?? null,
    lineUserId: parsed.data.lineUserId ?? null,
    consentStatus: parsed.data.consentStatus as ConsentStatus,
  };

  try {
    if (id) {
      await prisma.contact.update({ where: { id }, data });
      revalidatePath(`/contacts/${id}`);
    } else {
      const created = await prisma.contact.create({ data });
      id = created.id;
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return { ok: false, error: "That LINE user id is already linked to another contact.", fieldErrors: { lineUserId: "Already in use" } };
      if (err.code === "P2003") return { ok: false, error: "Selected company no longer exists.", fieldErrors: { companyId: "Unknown company" } };
    }
    return { ok: false, error: id ? "Contact not found." : "Could not create contact." };
  }

  revalidatePath("/contacts");
  revalidatePath(`/companies/${data.companyId}`);
  return { ok: true, id };
}

export type ToggleResult = { ok: true; enabled: boolean } | { ok: false; error: string };

// Instant-save for the standalone Auto Reply toggle on the contact detail page.
// Persists on its own, independent of the main contact form's Save button.
export async function setContactAutoReply(id: string, enabled: boolean): Promise<ToggleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (!canManageDirectory(user)) return { ok: false, error: "Forbidden" };

  const parsed = autoReplyToggleSchema.safeParse({ id, enabled });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid auto-reply update" };
  id = parsed.data.id;
  enabled = parsed.data.enabled;

  try {
    await prisma.contact.update({ where: { id }, data: { autoReplyEnabled: enabled } });
  } catch {
    return { ok: false, error: "Could not update auto-reply." };
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true, enabled };
}

export type ConnectLinkResult = { ok: true; url: string } | { ok: false; error: string };

// PLAN §11.9: mint a short-lived signed connect link an officer sends to a
// customer. Opening it in LINE binds the customer's verified LINE identity to
// THIS contact (contactId is baked into the signed token, never a plain param).
export async function createContactLineConnectLink(id: string): Promise<ConnectLinkResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (!canManageDirectory(user)) return { ok: false, error: "Forbidden" };

  const parsed = crmEntityIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid contact id" };

  const liffId = process.env.LINE_LIFF_ID?.trim();
  if (!liffId) return { ok: false, error: "LIFF is not configured (missing LINE_LIFF_ID)." };

  const contact = await prisma.contact.findUnique({ where: { id: parsed.data }, select: { id: true } });
  if (!contact) return { ok: false, error: "Contact not found." };

  const token = await signContactLinkToken(contact.id);
  return { ok: true, url: `https://liff.line.me/${liffId}?token=${encodeURIComponent(token)}` };
}
