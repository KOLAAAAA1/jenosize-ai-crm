import Link from "next/link";
import { prisma } from "@/lib/db";
import { ContactForm } from "../contact-form";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function NewContactPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const presetCompany = typeof sp.company === "string" ? sp.company : undefined;
  const companies = await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/contacts" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Contacts</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">New contact</h1>
      </div>
      <ContactForm companies={companies} initial={presetCompany ? { companyId: presetCompany } : undefined} />
    </div>
  );
}
