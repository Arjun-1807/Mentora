"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut, User } from "lucide-react";
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
import { useAuth } from "@/hooks/use-auth";
import { getUserEmail, getUserRole } from "@/lib/storage";

/** Routes that render their own chrome (sidebar shells, split-screen auth). */
const HIDDEN_PREFIXES = ["/dashboard", "/mentor/dashboard", "/login", "/register", "/join"];

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

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const [stored, setStored] = useState({ role: null, email: null });

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

  function handleSignOut() {
    signOut();
    router.push("/");
  }

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="fixed inset-x-0 top-0 z-40 h-16 border-b border-border bg-[oklch(0.147_0.004_49.25/0.85)] backdrop-blur-md"
      >
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="rounded-md text-xl font-extrabold tracking-tight text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            mentora
          </Link>

          {signedIn ? (
            <nav aria-label="Main" className="flex items-center gap-2 sm:gap-5">
              <ul className="hidden items-center gap-5 text-sm sm:flex">
                {links.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "rounded-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          active
                            ? "font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={email ? `Account menu for ${email}` : "Account menu"}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  }
                >
                  {initials || <User className="h-4 w-4" aria-hidden="true" />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate">
                      {name || email || "Signed in"}
                      {role && (
                        <span className="block text-[11px] font-normal capitalize text-muted-foreground">
                          {role}
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
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          ) : (
            // While auth is "loading" keep the buttons invisible so the bar never shifts.
            <nav
              aria-label="Main"
              className={cn("flex items-center gap-2", status === "loading" && "invisible")}
            >
              <Button variant="ghost" render={<Link href="/login" />}>
                Sign In
              </Button>
              <Button render={<Link href="/register" />}>Get Started</Button>
            </nav>
          )}
        </div>
      </motion.header>
      <div aria-hidden="true" className="h-16 shrink-0" />
    </>
  );
}
