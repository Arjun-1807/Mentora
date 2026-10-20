"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import PageWrapper from "@/components/layout/PageWrapper";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { getUserEmail } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/components/dashboard/helpers";

/**
 * Active tab, kept in sync with `?tab=` so tabs are linkable and survive a
 * reload. Unknown values fall back to the first tab. The caller must sit
 * inside a <Suspense> boundary (useSearchParams), or `next build` fails.
 */
export function useTabParam(tabIds, fallback = tabIds[0]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const active = tabIds.includes(requested) ? requested : fallback;

  const setTab = useCallback(
    (id) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id === fallback) params.delete("tab");
      else params.set("tab", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, fallback]
  );

  return [active, setTab];
}

function UserFooter({ email, onSignOut, compact = false }) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "" : "border-t border-border p-4")}>
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
      >
        {initialsOf(email)}
      </span>
      {!compact && (
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={email || undefined}>
          {email || "Signed in"}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        onClick={onSignOut}
        aria-label="Sign out"
        className="shrink-0"
      >
        <LogOut aria-hidden="true" />
        {!compact && <span>Sign Out</span>}
      </Button>
    </div>
  );
}

/**
 * Sidebar layout for the startup and mentor dashboards.
 *
 * - md and up: 240px fixed left sidebar (logo, nav, account + sign out) with
 *   the content offset by `ml-[240px]`.
 * - below md: a sticky top bar (logo + sign out) with the nav as a
 *   horizontally scrollable pill row, so nothing overflows on phones.
 *
 * `items` = [{id, label, icon: LucideIcon, badge?}], `active` = current id,
 * `onSelect(id)` switches tabs (use `useTabParam`).
 */
export default function DashboardShell({ items, active, onSelect, title, children }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [storedEmail, setStoredEmail] = useState(null);

  // localStorage is client-only: read it after mount to avoid a hydration mismatch.
  useEffect(() => {
    setStoredEmail(getUserEmail());
  }, []);

  const email = user?.email || storedEmail || "";

  function handleSignOut() {
    signOut();
    router.push("/");
  }

  const navButton = (item, mobile) => {
    const Icon = item.icon;
    const selected = item.id === active;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          mobile
            ? "shrink-0 rounded-full px-3 py-1.5"
            : "w-full rounded-lg px-3 py-2 text-left",
          selected
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {Icon && <Icon className={cn("shrink-0", mobile ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden="true" />}
        <span className={mobile ? "" : "flex-1"}>{item.label}</span>
        {typeof item.badge === "number" && item.badge > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
            {item.badge}
            <span className="sr-only"> new</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex-1">
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-border bg-sidebar md:flex"
        aria-label="Dashboard"
      >
        <div className="px-5 py-5">
          <Link
            href="/"
            className="text-xl font-extrabold tracking-tight text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
          >
            mentora
          </Link>
          {title && <p className="mt-1 text-xs text-muted-foreground">{title}</p>}
        </div>
        <nav aria-label="Dashboard sections" className="flex-1 space-y-1 overflow-y-auto px-3">
          {items.map((item) => navButton(item, false))}
        </nav>
        <UserFooter email={email} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile top bar + nav row */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-primary">
            mentora
          </Link>
          <UserFooter email={email} onSignOut={handleSignOut} compact />
        </div>
        <nav
          aria-label="Dashboard sections"
          className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]"
        >
          {items.map((item) => navButton(item, true))}
        </nav>
      </header>

      <main id="dashboard-main" className="min-w-0 md:ml-[240px]">
        <PageWrapper className="px-4 py-6 sm:px-6 md:py-10">{children}</PageWrapper>
      </main>
    </div>
  );
}
