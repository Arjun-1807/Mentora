"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCalendarAuthUrl, getCalendarStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Google Calendar connection state for the signed-in user.
 * `initial` (e.g. `/me`'s `calendar_connected`) is shown until GET
 * /calendar/status answers, which is the source of truth.
 */
export function useCalendarStatus(initial) {
  const [connected, setConnected] = useState(typeof initial === "boolean" ? initial : null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCalendarStatus()
      .then((res) => {
        if (!cancelled) setConnected(Boolean(res?.connected));
      })
      .catch(() => {
        // Keep whatever /me told us; fall back to "not connected".
        if (!cancelled) setConnected((prev) => (prev === null ? false : prev));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { connected, loading: loading && connected === null };
}

export function ConnectedBadge({ className }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1 border-emerald-500/40 bg-emerald-500/15 px-2.5 text-emerald-300", className)}
    >
      <Check aria-hidden="true" />
      Calendar Connected
    </Badge>
  );
}

/** Starts Google OAuth: fetches the auth URL and sends the browser there. */
export function ConnectCalendarButton({ size = "default", className, children = "Connect Google Calendar" }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await getCalendarAuthUrl();
      if (!res?.auth_url) throw new Error("The server didn't return a Google sign-in link.");
      window.location.assign(res.auth_url);
      // Leave the spinner on: the page is navigating away.
    } catch (err) {
      if (err?.status !== 0) toast.error(err.message || "Could not start Google Calendar sign-in.");
      setBusy(false);
    }
  }

  return (
    <Button type="button" size={size} onClick={handleClick} disabled={busy} className={className}>
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
      {children}
    </Button>
  );
}

/** Compact status line: green badge when connected, connect button otherwise. */
export function CalendarStatus({ initial, size = "default" }) {
  const { connected, loading } = useCalendarStatus(initial);
  if (loading) return <Skeleton className="h-8 w-48" />;
  return connected ? <ConnectedBadge /> : <ConnectCalendarButton size={size} />;
}

/** Small dashboard card (startup Overview): booking needs a connected calendar. */
export default function CalendarConnectCard({ initial, className }) {
  const { connected, loading } = useCalendarStatus(initial);
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
          Google Calendar
        </CardTitle>
        <CardDescription>
          {connected
            ? "Meetings you book with mentors land on your calendar with a Meet link."
            : "Connect your calendar so you can book meetings with accepted mentors."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-48" />
        ) : connected ? (
          <ConnectedBadge />
        ) : (
          <ConnectCalendarButton size="sm" />
        )}
      </CardContent>
    </Card>
  );
}
