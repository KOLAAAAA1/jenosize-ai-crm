import { requireUser } from "@/lib/auth";
import { AppHeader } from "./app-header";

// Server-side guard for every page in this route group: unauthenticated
// requests are redirected to /login before any protected page renders.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader user={{ name: user.name, email: user.email, role: user.role }} />
      <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-4 py-8">{children}</main>
    </div>
  );
}
