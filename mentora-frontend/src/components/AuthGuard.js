"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRequireAuth } from "@/hooks/use-auth";

/**
 * Wraps a protected page. While we're reading the token (and if there isn't
 * one) it renders a loading frame instead of the page, so protected content
 * never flashes before the redirect to /login.
 *
 * Optional `requiredRole` ("startup" | "mentor"):
 *   - If the signed-in user has the wrong role, redirects them to their own
 *     dashboard instead of showing a 403.
 *   - Leave undefined to allow any authenticated role (existing behaviour).
 */
export default function AuthGuard({ children, requiredRole }) {
  const router = useRouter();
  const { status, user } = useRequireAuth();

  useEffect(() => {
    if (status !== "signed-in" || !requiredRole || !user?.role) return;
    if (user.role === requiredRole) return;

    // Redirect wrong-role users to their own dashboard.
    const correctDash = user.role === "mentor" ? "/mentor/dashboard" : "/dashboard";
    router.replace(correctDash);
  }, [status, user, requiredRole, router]);

  if (status === "signed-in") {
    // If role check is needed and user data hasn't loaded yet, keep showing
    // the loader so protected content doesn't flash.
    if (requiredRole && !user?.role) {
      return <LoadingFrame status="loading" />;
    }
    // Wrong role — redirect is in-flight, keep spinner visible.
    if (requiredRole && user?.role && user.role !== requiredRole) {
      return <LoadingFrame status="loading" />;
    }
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
        className="flex flex-col items-center gap-3 text-muted-foreground"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <p className="text-sm">
          {status === "signed-out"
            ? "Redirecting you to sign in…"
            : "Checking your session…"}
        </p>
      </div>
    </main>
  );
}
