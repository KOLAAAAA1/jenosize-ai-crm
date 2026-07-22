import type { Prisma } from "@prisma/client";
import { INDUSTRIES, COMPANY_SIZES } from "./crm";

export type CompanyFilterInput = {
  q?: string;
  industry?: string;
  size?: string;
};

// Pure builder: raw (untrusted) filter params → a validated Prisma where clause.
// Unknown industry/size values are ignored rather than throwing, mirroring
// buildLeadWhere.
export function buildCompanyWhere(input: CompanyFilterInput): Prisma.CompanyWhereInput {
  const q = input.q?.trim();
  const industry =
    input.industry && (INDUSTRIES as readonly string[]).includes(input.industry) ? input.industry : undefined;
  const size =
    input.size && (COMPANY_SIZES as readonly string[]).includes(input.size) ? input.size : undefined;

  return {
    ...(industry ? { industry } : {}),
    ...(size ? { size } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { website: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
