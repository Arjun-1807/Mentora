"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarX2, Loader2 } from "lucide-react";
import PageWrapper from "@/components/layout/PageWrapper";
import { StateCard } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { submitCalendarCallback } from "@/lib/api";
import { getUserRole, roleHome } from "@/lib/storage";

// Google's `code` is single-use. React strict mode (dev) mounts effects twice
// and a remount would re-run them too, so remember which codes this tab has
// already sent at module level, not just per component instance.
const submittedCodes = new Set();

/** Mentors land back on the Profile tab, where the calendar + availability live. */
function destinationFor(role) {
  const home = roleHome(role);
  return role === "mentor" ? `${home}?tab=profile` : home;
}

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const [failure, setFailure] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (oauthError) {
      const message =
        oauthError === "access_denied"
          ? "Google Calendar access was not granted."
          : `Google sign-in failed (${oauthError}).`;
      toast.error(message);
      router.replace(destinationFor(getUserRole()));
      return;
    }

    if (!code || !state) {
      setFailure("This link is missing the details Google sends back. Start the connection again from your dashboard.");
      return;
    }

    if (submittedCodes.has(code)) return;
    submittedCodes.add(code);

    submitCalendarCallback(code, state)
      .then((res) => {
        toast.success("Google Calendar connected.");
        router.replace(destinationFor(res?.role || getUserRole()));
      })
      .catch((err) => {
        const message = err?.message || "Could not connect your Google Calendar.";
        if (err?.status !== 0) toast.error(message);
        setFailure(message);
      });
  }, [code, state, oauthError, router]);

  if (failure) {
    return (
      <StateCard
        tone="error"
        icon={CalendarX2}
        title="Calendar not connected"
        description={failure}
        actions={
          <Button render={<Link href={destinationFor(getUserRole())} />}>Back to dashboard</Button>
        }
      />
    );
  }

  return <Connecting />;
}

function Connecting() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm">Connecting your Google Calendar…</p>
    </div>
  );
}

export default function CalendarCallbackPage() {
  return (
    <main className="flex flex-1 items-center">
      <PageWrapper className="max-w-md">
        {/* useSearchParams needs a Suspense boundary or `next build` fails. */}
        <Suspense fallback={<Connecting />}>
          <CallbackContent />
        </Suspense>
      </PageWrapper>
    </main>
  );
}
