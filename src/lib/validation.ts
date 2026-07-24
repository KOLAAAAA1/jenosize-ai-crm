import { z } from "zod";
import { INDUSTRIES, COMPANY_SIZES, CONSENT_STATUSES, STAGES } from "./crm";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Opaque database IDs are still untrusted when they arrive through a Server
// Action. Their exact cuid/UUID shape varies across seeded/test/provider rows,
// so validate safe presence and bounded length rather than one implementation.
export const crmEntityIdSchema = z.string().trim().min(1, "Missing record id").max(200, "Invalid record id");
export const stageMoveSchema = z.object({
  leadId: crmEntityIdSchema,
  nextStage: z.enum(STAGES),
});
export const suggestionReviewSchema = z.object({
  id: crmEntityIdSchema,
  decision: z.enum(["ACCEPTED", "REJECTED"]),
});
export const autoReplyToggleSchema = z.object({
  id: crmEntityIdSchema,
  enabled: z.boolean(),
});

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

// LIFF account-link request (PLAN §11.9): the verified LINE ID token + the signed
// contact-link token from the officer's URL + a one-tap PDPA confirm.
export const liffConnectSchema = z.object({
  idToken: z.string().trim().min(1, "Missing LINE identity token"),
  token: z.string().trim().min(1, "Missing connect link token"),
  consent: z.boolean().default(false),
});
export type LiffConnectInput = z.infer<typeof liffConnectSchema>;

// LIFF status probe: is this verified LINE user already a linked contact?
export const liffStatusSchema = z.object({ idToken: z.string().trim().min(1, "Missing LINE identity token") });

// Follow-up task on a lead (PLAN §11.2). `dueAt` is an optional yyyy-mm-dd string
// from a date input; the action converts it to a Date.
export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  dueAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), { message: "Invalid due date" }),
});
export type TaskInput = z.infer<typeof taskSchema>;

// P1 deal fields. Null explicitly means "not decided yet" so early-stage
// opportunities are not forced into false precision.
export const dealFieldsSchema = z.object({
  probability: z.number().int().min(0, "Probability must be at least 0").max(100, "Probability cannot exceed 100").nullable(),
  expectedCloseAt: z
    .string()
    .trim()
    .nullable()
    .refine((v) => v === null || (v.length > 0 && !Number.isNaN(Date.parse(v))), { message: "Invalid expected close date" }),
});
export type DealFieldsInput = z.infer<typeof dealFieldsSchema>;

export const leadAssignmentSchema = z.object({
  ownerId: z.string().trim().min(1, "Select an owner"),
});
export type LeadAssignmentInput = z.infer<typeof leadAssignmentSchema>;

export const emailDraftSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Email body is required").max(10_000),
});
export type EmailDraftInput = z.infer<typeof emailDraftSchema>;
