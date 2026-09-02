"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

const NAV_LINKS = [
  { href: "/upload", label: "Upload" },
  { href: "/matches", label: "Matches" },
  { href: "/dashboard", label: "Dashboard" },
];

function displayName(user) {
  if (!user) return null;
  return user.profile?.name || user.name || user.email || null;
}

function initialsFor(user) {
  const name = displayName(user);
  if (!name) return null;
  const parts = name.replace(/@.*$/, "").trim().split(/[\s._-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return initials.join("") || null;
}

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, signOut } = useAuth();

  function handleSignOut() {
    signOut();
    router.push("/");
  }

  const name = displayName(user);
  const initials = initialsFor(user);

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center bg-primary text-primary-foreground font-bold text-lg">
            M
          </span>
          <span className="text-xl font-bold tracking-tight text-foreground">
            Mentora
          </span>
        </Link>

        {status === "signed-in" ? (
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-4">
            <ul className="hidden sm:flex items-center gap-4 text-sm">
              {NAV_LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                        active
                          ? "text-foreground font-medium"
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
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={name ? `Account menu for ${name}` : "Account menu"}
                  />
                }
              >
                <Avatar size="sm">
                  <AvatarFallback>
                    {initials || <User className="h-3.5 w-3.5" aria-hidden="true" />}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel className="truncate">
                  {name || "Signed in"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup className="sm:hidden">
                  {NAV_LINKS.map((link) => (
                    <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
                      {link.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </DropdownMenuGroup>
                <DropdownMenuItem render={<Link href="/profile" />}>
                  <User aria-hidden="true" />
                  Startup profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                  <LogOut aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        ) : (
          // While `status` is "loading" we render the signed-out actions but
          // keep them invisible, so the header height/layout never shifts.
          <nav
            aria-label="Main"
            className={cn(
              "flex items-center gap-2",
              status === "loading" && "invisible"
            )}
          >
            <Button size="sm" variant="ghost" render={<Link href="/login" />}>
              Sign In
            </Button>
            <Button size="sm" render={<Link href="/register" />}>
              Get Started
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
}
