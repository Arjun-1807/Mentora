"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/api";
import {
  AUTH_EVENT,
  clearSession,
  getToken,
  getUserRole,
  setUserEmail,
  setUserRole,
} from "@/lib/storage";

/**
 * Auth state for the current tab.
 *
 * `status` is one of:
 *   - "loading"    — we haven't read localStorage yet (first client render)
 *   - "signed-in"  — a token is present
 *   - "signed-out" — no token
 *
 * `user` is the `/me` payload (`{id, email, role, profile, calendar_connected}`)
 * once it resolves. `userStatus` tracks that request: "idle" | "loading" |
 * "ready" | "error". If /me fails, `user` stays `null` and `role` falls back
 * to the `userRole` cached in localStorage.
 */
export function useAuth() {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [userStatus, setUserStatus] = useState("idle");
  const [storedRole, setStoredRole] = useState(null);

  useEffect(() => {
    let active = true;

    function sync() {
      const token = getToken();
      if (!active) return;
      setStoredRole(getUserRole());
      if (!token) {
        setStatus("signed-out");
        setUser(null);
        setUserStatus("idle");
        return;
      }
      setStatus("signed-in");
      setUserStatus((prev) => (prev === "ready" ? prev : "loading"));
      getMe()
        .then((data) => {
          if (!active) return;
          if (data && typeof data === "object") {
            setUser(data);
            // Keep the cached role/email in step with the server.
            if (data.role) setUserRole(data.role);
            if (data.email) setUserEmail(data.email);
            setStoredRole(data.role || getUserRole());
          }
          setUserStatus("ready");
        })
        .catch(() => {
          // /me may be unreachable — not fatal; fall back to cached role.
          if (!active) return;
          setUser(null);
          setUserStatus("error");
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
    setUserStatus("idle");
    setStoredRole(null);
  }, []);

  // Re-runs the /me sync (e.g. a "Try again" after userStatus === "error").
  // Goes through AUTH_EVENT so every useAuth instance picks up the result.
  const refresh = useCallback(() => {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }, []);

  return {
    status,
    user,
    userStatus,
    role: user?.role || storedRole || null,
    signOut,
    refresh,
    isSignedIn: status === "signed-in",
  };
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
