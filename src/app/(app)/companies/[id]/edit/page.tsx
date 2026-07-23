import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageDirectory } from "@/lib/access-control";
import { CompanyForm } from "../../company-form";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canManageDirectory(user)) notFound();
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/companies/${company.id}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← {company.name}</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Edit company</h1>
      </div>
      <CompanyForm initial={company} />
    </div>
  );
}
