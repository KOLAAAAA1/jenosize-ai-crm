import Link from "next/link";
import { CompanyForm } from "../company-form";

export default function NewCompanyPage() {
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
