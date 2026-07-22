"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { companySchema } from "@/lib/validation";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function firstErrors(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldErrors)) if (v?.[0]) out[k] = v[0];
  return out;
}

// Create (id === null) or update a company. Zod-validated; returns a typed
// result so the client form can surface field errors and navigate on success.
export async function saveCompany(id: string | null, formData: FormData): Promise<SaveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: firstErrors(parsed.error.flatten().fieldErrors) };
  }

  const data = {
    name: parsed.data.name,
    industry: parsed.data.industry ?? null,
    size: parsed.data.size ?? null,
    website: parsed.data.website ?? null,
    notes: parsed.data.notes ?? null,
  };

  try {
    if (id) {
      await prisma.company.update({ where: { id }, data });
      revalidatePath(`/companies/${id}`);
    } else {
      const created = await prisma.company.create({ data });
      id = created.id;
    }
  } catch {
    return { ok: false, error: id ? "Company not found." : "Could not create company." };
  }

  revalidatePath("/companies");
  return { ok: true, id };
}
