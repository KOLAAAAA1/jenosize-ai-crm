import { z } from "zod";
import { INDUSTRIES, COMPANY_SIZES, CONSENT_STATUSES } from "./crm";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Empty-string form fields become `undefined` (an omitted optional) rather than
// "" so nullable DB columns stay clean. Applied to every optional text input.
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address",
  });

export const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  industry: z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .refine((v) => v === undefined || (INDUSTRIES as readonly string[]).includes(v), {
      message: "Unknown industry",
    }),
  size: z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .refine((v) => v === undefined || (COMPANY_SIZES as readonly string[]).includes(v), {
      message: "Unknown company size",
    }),
  website: optionalText,
  notes: optionalText,
});
export type CompanyInput = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  companyId: z.string().trim().min(1, "A company is required"),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: optionalEmail,
  phone: optionalText,
  title: optionalText,
  lineUserId: optionalText,
  consentStatus: z
    .string()
    .trim()
    .default("UNKNOWN")
    .refine((v) => (CONSENT_STATUSES as readonly string[]).includes(v), {
      message: "Invalid consent status",
    }),
  // Note: `autoReplyEnabled` is deliberately NOT here — it is saved instantly by its
  // own toggle (setContactAutoReply), so the main form save must never touch it.
});
export type ContactInput = z.infer<typeof contactSchema>;

// Customer-facing LIFF self-registration. `idToken` is verified server-side; the
// LINE userId is taken from the verified token, never from the client.
export const liffRegisterSchema = z.object({
  idToken: z.string().trim().min(1, "Missing LINE identity token"),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: optionalEmail,
  phone: optionalText,
  consent: z.boolean().default(false),
});
export type LiffRegisterFormInput = z.infer<typeof liffRegisterSchema>;
