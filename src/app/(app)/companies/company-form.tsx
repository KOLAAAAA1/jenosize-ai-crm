"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { INDUSTRIES, COMPANY_SIZES } from "@/lib/crm";
import { saveCompany } from "./actions";

export type CompanyFormValues = {
  id?: string;
  name?: string;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  notes?: string | null;
};

const fieldClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const labelClass = "text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

export function CompanyForm({ initial }: { initial?: CompanyFormValues }) {
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
      const res = await saveCompany(initial?.id ?? null, formData);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        return;
      }
      router.push(`/companies/${res.id}`);
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
        <span className={labelClass}>Company name *</span>
        <input name="name" defaultValue={initial?.name ?? ""} className={fieldClass} autoFocus />
        {fieldError("name")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Industry</span>
          <select name="industry" defaultValue={initial?.industry ?? ""} className={fieldClass}>
            <option value="">—</option>
            {INDUSTRIES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {fieldError("industry")}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Size</span>
          <select name="size" defaultValue={initial?.size ?? ""} className={fieldClass}>
            <option value="">—</option>
            {COMPANY_SIZES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {fieldError("size")}
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Website</span>
        <input name="website" defaultValue={initial?.website ?? ""} placeholder="https://…" className={fieldClass} />
        {fieldError("website")}
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Notes</span>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} rows={3} className={fieldClass} />
        {fieldError("notes")}
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Create company"}
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
