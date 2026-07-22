import type { Prisma } from "@prisma/client";
import { isConsentStatus } from "./crm";

export type ContactFilterInput = {
  q?: string;
  companyId?: string;
  line?: string; // "yes" | "no" — filter on presence of a LINE mapping
  consent?: string;
};

// Pure builder: raw (untrusted) filter params → a validated Prisma where clause.
// Free-text q matches name / email / phone. Invalid consent values are ignored.
export function buildContactWhere(input: ContactFilterInput): Prisma.ContactWhereInput {
  const q = input.q?.trim();
  const companyId = input.companyId?.trim() || undefined;
  const consentStatus = isConsentStatus(input.consent) ? input.consent : undefined;

  const line =
    input.line === "yes"
      ? { lineUserId: { not: null } }
      : input.line === "no"
        ? { lineUserId: null }
        : {};

  // Tokenize the query and AND the tokens, each token matching any of the split
  // name fields / email / phone. This makes a full-name search ("สมชาย ธรรมเสน")
  // work across the separate firstName/lastName columns — a single OR on the two
  // columns would match neither for a multi-word query.
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const tokenClauses = tokens.map((t) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" as const } },
      { lastName: { contains: t, mode: "insensitive" as const } },
      { email: { contains: t, mode: "insensitive" as const } },
      { phone: { contains: t, mode: "insensitive" as const } },
    ],
  }));

  return {
    ...(companyId ? { companyId } : {}),
    ...(consentStatus ? { consentStatus } : {}),
    ...line,
    ...(tokenClauses.length ? { AND: tokenClauses } : {}),
  };
}
