"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowLeft, CalendarCheck2, CalendarX2 } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
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
          <Button render={<Link href={destinationFor(getUserRole())} />}>
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </Button>
        }
      />
    );
  }

  return <Connecting />;
}

/** Animated "linking" visual: Mentora mark and a calendar joined by travelling dots. */
function Connecting() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="surface relative flex flex-col items-center overflow-hidden rounded-3xl px-6 py-12 text-center"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl"
      />
      <div aria-hidden="true" className="relative flex items-center gap-3">
        <LogoMark className="size-12 rounded-2xl" />
        <div className="flex w-16 items-center justify-between">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
            />
          ))}
        </div>
        <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-soft">
          <CalendarCheck2 className="size-6" />
        </span>
      </div>
      <h1 className="relative mt-8 text-lg font-semibold tracking-tight text-foreground">
        Connecting your Google Calendar…
      </h1>
      <p className="relative mt-2 max-w-xs text-sm text-muted-foreground">
        Hang tight — we&apos;re finishing the handshake with Google. This only takes a moment.
      </p>
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
