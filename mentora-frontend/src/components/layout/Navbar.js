"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowRight, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { SPRING } from "@/components/motion";
import { useAuth } from "@/hooks/use-auth";
import { getUserEmail, getUserRole } from "@/lib/storage";

/** Routes that render their own chrome (sidebar shells, split-screen auth). */
const HIDDEN_PREFIXES = ["/dashboard", "/mentor/dashboard", "/login", "/register"];

const ROLE_LINKS = {
  startup: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/upload", label: "Upload Deck" },
  ],
  mentor: [{ href: "/mentor/dashboard", label: "My Dashboard" }],
  coordinator: [{ href: "/coordinator/cohort", label: "Cohort" }],
};

export function isNavbarHidden(pathname) {
  if (!pathname) return false;
  return HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function initialsFrom(text) {
  const parts = String(text || "")
    .replace(/@.*$/, "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

/**
 * Floating glass navbar. It sits as a wide bar at the top of the page and
 * condenses into a narrower, more opaque pill once the page scrolls. The
 * active link is marked by a pill that slides between links (layoutId).
 */
export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const [stored, setStored] = useState({ role: null, email: null });
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(null);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  // localStorage is only readable after mount; re-read whenever auth changes.
  useEffect(() => {
    setStored({ role: getUserRole(), email: getUserEmail() });
  }, [status, user]);

  if (isNavbarHidden(pathname)) return null;

  const signedIn = status === "signed-in";
  const role = stored.role || user?.role || "startup";
  const links = ROLE_LINKS[role] || ROLE_LINKS.startup;
  const email = stored.email || user?.email || "";
  const name = user?.profile?.name || "";
  const initials = initialsFrom(name || email);
  const highlighted = hovered ?? links.find((l) => pathname === l.href)?.href ?? null;

  function handleSignOut() {
    signOut();
    router.push("/");
  }

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4"
      >
        <motion.div
          layout
          transition={SPRING.soft}
          className={cn(
            "mx-auto flex h-14 items-center justify-between gap-4 rounded-2xl pl-4 pr-2 transition-[background-color,border-color,box-shadow] duration-300",
            scrolled
              ? "glass max-w-4xl shadow-soft"
              : "max-w-6xl border border-transparent bg-transparent"
          )}
        >
          <Logo />

          {signedIn ? (
            <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
              <ul
                className="hidden items-center sm:flex"
                onPointerLeave={() => setHovered(null)}
              >
                {links.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <li key={link.href} className="relative">
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        onPointerEnter={() => setHovered(link.href)}
                        className={cn(
                          "relative z-10 block rounded-full px-3.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          active || hovered === link.href
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {link.label}
                      </Link>
                      {highlighted === link.href && (
                        <motion.span
                          layoutId="nav-pill"
                          transition={SPRING.snappy}
                          aria-hidden="true"
                          className={cn(
                            "absolute inset-0 rounded-full",
                            active ? "bg-primary/12 ring-1 ring-primary/20" : "bg-muted"
                          )}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>

              <ThemeToggle />

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={email ? `Account menu for ${email}` : "Account menu"}
                      className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_50%)] text-xs font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] outline-none ring-2 ring-background transition-transform hover:scale-105 focus-visible:ring-ring/60"
                    />
                  }
                >
                  {initials || <User className="size-4" aria-hidden="true" />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate py-2">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {name || email || "Signed in"}
                      </span>
                      {role && (
                        <span className="mt-0.5 block text-xs font-normal capitalize text-muted-foreground">
                          {role} account
                        </span>
                      )}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="sm:hidden" />
                  <DropdownMenuGroup className="sm:hidden">
                    {links.map((link) => (
                      <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
                        {link.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                    <LogOut aria-hidden="true" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          ) : (
            // While auth is "loading" keep the buttons invisible so the bar never shifts.
            <nav
              aria-label="Main"
              className={cn("flex items-center gap-1", status === "loading" && "invisible")}
            >
              <ThemeToggle />
              <Button variant="ghost" className="hidden sm:inline-flex" render={<Link href="/login" />}>
                Sign in
              </Button>
              <Button className="rounded-full pr-3" render={<Link href="/register" />}>
                Get started
                <ArrowRight
                  className="transition-transform group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              </Button>
            </nav>
          )}
        </motion.div>
      </motion.header>
      <div aria-hidden="true" className="h-20 shrink-0" />
    </>
  );
}
