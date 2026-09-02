"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/api";
import { AUTH_EVENT, clearSession, getToken } from "@/lib/storage";

/**
 * Auth state for the current tab.
 *
 * `status` is one of:
 *   - "loading"    — we haven't read localStorage yet (first client render)
 *   - "signed-in"  — a token is present
 *   - "signed-out" — no token
 *
 * `user` is the `/me` payload (`{id, email, role, profile}`) once it resolves.
 * That endpoint is optional: if it 404s or fails, `user` stays `null` and
 * callers should fall back to a generic account UI.
 */
export function useAuth() {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);

  useEffect(() => {
    let active = true;

    function sync() {
      const token = getToken();
      if (!active) return;
      if (!token) {
        setStatus("signed-out");
        setUser(null);
        return;
      }
      setStatus("signed-in");
      getMe()
        .then((data) => {
          if (active && data && typeof data === "object") setUser(data);
        })
        .catch(() => {
          // /me may not exist yet, or may be unreachable — not fatal.
          if (active) setUser(null);
        });
    }

    sync();

    // Same tab (our own setToken/clearToken) and other tabs (`storage`).
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      active = false;
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setStatus("signed-out");
    setUser(null);
  }, []);

  return { status, user, signOut, isSignedIn: status === "signed-in" };
}

/**
 * Same as `useAuth`, but redirects to /login when no token is present.
 * Use via `<AuthGuard>` rather than calling directly in a page.
 */
export function useRequireAuth() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== "signed-out") return;
    const { pathname, search } = window.location;
    const next = encodeURIComponent(`${pathname}${search || ""}`);
    router.replace(`/login?next=${next}`);
  }, [auth.status, router]);

  return auth;
}
