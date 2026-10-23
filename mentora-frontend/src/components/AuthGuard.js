"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand/Logo";
import { useRequireAuth } from "@/hooks/use-auth";
import { roleHome } from "@/lib/storage";

/**
 * Wraps a protected page. While we're reading the token (and if there isn't
 * one) it renders a loading frame instead of the page, so protected content
 * never flashes before the redirect to /login.
 *
 * Optional `requiredRole` ("startup" | "mentor" | "coordinator", or an array
 * of them):
 *   - The role comes from /me, falling back to localStorage `userRole` if
 *     /me can't be reached.
 *   - A signed-in user with another role is sent to their own home
 *     (startup /dashboard, mentor /mentor/dashboard, coordinator
 *     /coordinator/cohort) instead of seeing a 403.
 *   - Leave undefined to allow any authenticated role.
 */
export default function AuthGuard({ children, requiredRole }) {
  const router = useRouter();
  const { status, user, userStatus, role } = useRequireAuth();

  const allowed = requiredRole
    ? Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole]
    : null;
  // Prefer the server's answer; only trust the cached role once /me is done.
  const resolvedRole = user?.role || (userStatus === "error" || userStatus === "ready" ? role : null);
  const roleKnown = Boolean(resolvedRole);
  const roleSettled = roleKnown || userStatus === "error" || userStatus === "ready";
  const wrongRole = Boolean(allowed && roleKnown && !allowed.includes(resolvedRole));

  useEffect(() => {
    if (status !== "signed-in" || !wrongRole) return;
    router.replace(roleHome(resolvedRole));
  }, [status, wrongRole, resolvedRole, router]);

  if (status === "signed-in") {
    // Role check pending — keep the loader so protected content doesn't flash.
    if (allowed && !roleSettled) return <LoadingFrame status="loading" />;
    // Wrong role — redirect is in flight.
    if (wrongRole) return <LoadingFrame status="redirecting" />;
    return children;
  }

  return <LoadingFrame status={status} />;
}

function LoadingFrame({ status }) {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-24">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-5 text-muted-foreground"
      >
        <span className="relative flex size-12 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-spin rounded-full border-2 border-primary/15 border-t-primary"
          />
          <LogoMark className="size-7 rounded-lg" />
        </span>
        <p className="text-sm">
          {status === "signed-out"
            ? "Redirecting you to sign in…"
            : status === "redirecting"
              ? "Taking you to your dashboard…"
              : "Checking your session…"}
        </p>
      </div>
    </main>
  );
}
