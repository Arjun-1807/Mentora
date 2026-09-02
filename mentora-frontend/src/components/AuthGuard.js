"use client";

import { Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useRequireAuth } from "@/hooks/use-auth";

/**
 * Wraps a protected page. While we're reading the token (and if there isn't
 * one) it renders a loading frame instead of the page, so protected content
 * never flashes before the redirect to /login.
 */
export default function AuthGuard({ children }) {
  const { status } = useRequireAuth();

  if (status === "signed-in") return children;

  return (
    <>
      <Navbar />
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
    </>
  );
}
