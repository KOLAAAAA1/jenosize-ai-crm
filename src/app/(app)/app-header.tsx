"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type SessionUser = { name: string; email: string; role: string };

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/board", label: "Pipeline" },
  { href: "/tasks", label: "Tasks" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
] as const;

// "/" must match exactly (every path starts with it); all others match the
// section root or any nested route under it.
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// App shell header. Client component so it can own the mobile-drawer open state
// and highlight the active link (usePathname). The parent server layout does the
// auth and passes the resolved `user` down as a plain-serializable prop.
export function AppHeader({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // While the drawer is open: lock background scroll and close on Escape.
  // (The drawer also closes on link tap via each link's onClick below — closing
  // there rather than in a pathname effect avoids a setState-in-effect cascade.)
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const desktopLink = (active: boolean) =>
    active
      ? "rounded-lg px-2 py-1 text-sm font-medium text-zinc-900 dark:text-zinc-50"
      : "rounded-lg px-2 py-1 text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

  const drawerLink = (active: boolean) =>
    active
      ? "rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
      : "rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100";

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* Left — brand + navigation links (desktop) */}
        <div className="flex items-center gap-6">
          <Link href="/" className="shrink-0 text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            AI CRM
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={desktopLink(isActive(pathname, l.href))}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right — profile + sign out (desktop) */}
        <div className="hidden items-center gap-3 md:flex">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{user.name}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {user.email} · {user.role}
            </p>
          </div>
          <div className="shrink-0">
            <LogoutButton />
          </div>
        </div>

        {/* Right — hamburger (mobile) */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-100 md:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer — collapsible sidebar */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside
            id="mobile-nav"
            className="absolute right-0 top-0 flex h-full w-72 max-w-[80%] flex-col bg-white shadow-xl dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">AI CRM</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  className={drawerLink(isActive(pathname, l.href))}
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
              <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{user.name}</p>
              <p className="mb-3 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {user.email} · {user.role}
              </p>
              <LogoutButton />
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
