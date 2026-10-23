"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import PageWrapper from "@/components/layout/PageWrapper";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { getUserEmail } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/components/dashboard/helpers";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { SPRING } from "@/components/motion";

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
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onSignOut}
          aria-label="Sign out"
          className="shrink-0 rounded-full"
        >
          <LogOut aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <div className="m-3 rounded-2xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_50%)] text-xs font-semibold text-primary-foreground"
        >
          {initialsOf(email)}
        </span>
        <p
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={email || undefined}
        >
          {email || "Signed in"}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <ThemeToggle className="size-8" />
        <Button type="button" variant="ghost" size="sm" onClick={onSignOut} className="shrink-0">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

/**
 * Sidebar layout for the startup and mentor dashboards.
 *
 * - md and up: 256px fixed glass sidebar (logo, nav, account card) with the
 *   content offset by `md:ml-64`. The active item is marked by a pill that
 *   slides between items (layoutId).
 * - below md: a sticky glass top bar (logo + theme + sign out) with the nav as
 *   a horizontally scrollable pill row, so nothing overflows on phones.
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
          "group relative flex items-center gap-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          mobile ? "shrink-0 rounded-full px-3.5 py-1.5" : "w-full rounded-xl px-3 py-2.5 text-left",
          selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {selected && (
          <motion.span
            layoutId={mobile ? "dash-nav-mobile" : "dash-nav"}
            transition={SPRING.snappy}
            aria-hidden="true"
            className={cn(
              "absolute inset-0 -z-10 bg-primary/12 ring-1 ring-primary/20",
              mobile ? "rounded-full" : "rounded-xl"
            )}
          />
        )}
        {!selected && !mobile && (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-xl bg-muted opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
        {Icon && (
          <Icon
            className={cn(
              "shrink-0 transition-colors",
              mobile ? "size-3.5" : "size-[18px]",
              selected ? "text-primary" : ""
            )}
            aria-hidden="true"
          />
        )}
        <span className={mobile ? "" : "flex-1"}>{item.label}</span>
        {typeof item.badge === "number" && item.badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-spark px-1.5 text-[11px] font-semibold tabular-nums text-spark-foreground">
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
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl md:flex"
        aria-label="Dashboard"
      >
        <div className="px-5 pb-6 pt-6">
          <Logo />
          {title && (
            <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </p>
          )}
        </div>
        <nav aria-label="Dashboard sections" className="isolate flex-1 space-y-1 overflow-y-auto px-3">
          {items.map((item) => navButton(item, false))}
        </nav>
        <UserFooter email={email} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile top bar + nav row */}
      <header className="glass sticky top-0 z-30 border-x-0! border-t-0! md:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Logo />
          <UserFooter email={email} onSignOut={handleSignOut} compact />
        </div>
        <nav
          aria-label="Dashboard sections"
          className="scrollbar-none isolate flex gap-1 overflow-x-auto px-3 pb-2.5"
        >
          {items.map((item) => navButton(item, true))}
        </nav>
      </header>

      <main id="dashboard-main" className="min-w-0 md:ml-64">
        <PageWrapper className="px-4 py-6 sm:px-6 md:px-10 md:py-10">{children}</PageWrapper>
      </main>
    </div>
  );
}
