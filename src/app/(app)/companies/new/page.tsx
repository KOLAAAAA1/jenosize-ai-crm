import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageDirectory } from "@/lib/access-control";
import { CompanyForm } from "../company-form";

export default async function NewCompanyPage() {
  const user = await requireUser();
  if (!canManageDirectory(user)) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/companies" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Companies</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">New company</h1>
      </div>
      <CompanyForm />
    </div>
  );
}
