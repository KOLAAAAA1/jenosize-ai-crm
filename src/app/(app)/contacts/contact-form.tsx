"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CONSENT_STATUSES, CONSENT_META } from "@/lib/crm";
import { saveContact } from "./actions";

export type ContactFormValues = {
  id?: string;
  companyId?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  lineUserId?: string | null;
  consentStatus?: string;
};

const fieldClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const labelClass = "text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

export function ContactForm({
  companies,
  initial,
}: {
  companies: { id: string; name: string }[];
  initial?: ContactFormValues;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await saveContact(initial?.id ?? null, formData);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        return;
      }
      router.push(`/contacts/${res.id}`);
      router.refresh();
    });
  }

  function fieldError(name: string) {
    return errors[name] ? <span className="text-xs text-red-600 dark:text-red-400">{errors[name]}</span> : null;
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {formError}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Company *</span>
        <select name="companyId" defaultValue={initial?.companyId ?? ""} className={fieldClass}>
          <option value="" disabled>Select a company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {fieldError("companyId")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>First name *</span>
          <input name="firstName" defaultValue={initial?.firstName ?? ""} className={fieldClass} autoFocus />
          {fieldError("firstName")}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Last name *</span>
          <input name="lastName" defaultValue={initial?.lastName ?? ""} className={fieldClass} />
          {fieldError("lastName")}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Email</span>
          <input name="email" type="email" defaultValue={initial?.email ?? ""} className={fieldClass} />
          {fieldError("email")}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Phone</span>
          <input name="phone" defaultValue={initial?.phone ?? ""} className={fieldClass} />
          {fieldError("phone")}
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Job title</span>
        <input name="title" defaultValue={initial?.title ?? ""} className={fieldClass} />
        {fieldError("title")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>LINE user id</span>
          <input name="lineUserId" defaultValue={initial?.lineUserId ?? ""} placeholder="U…" className={fieldClass} />
          {fieldError("lineUserId")}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Consent</span>
          <select name="consentStatus" defaultValue={initial?.consentStatus ?? "UNKNOWN"} className={fieldClass}>
            {CONSENT_STATUSES.map((v) => (
              <option key={v} value={v}>{CONSENT_META[v].label}</option>
            ))}
          </select>
          {fieldError("consentStatus")}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Create contact"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
