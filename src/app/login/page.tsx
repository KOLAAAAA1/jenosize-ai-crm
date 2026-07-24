import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Image src="/crm-handshake-growth-profile-icon.png" alt="" width={56} height={56} priority className="mx-auto mb-3 h-14 w-14 rounded-xl object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">AI CRM</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Sign in to your workspace</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <LoginForm />
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-100/60 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">Demo accounts</p>
          <p className="mt-1 font-mono">admin@jenosize.demo · manager@jenosize.demo · sales@jenosize.demo</p>
          <p className="mt-0.5">Password: <span className="font-mono">Demo1234!</span></p>
        </div>
      </div>
    </main>
  );
}
