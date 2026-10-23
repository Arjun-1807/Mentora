"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Globe2,
  Layers,
  Lightbulb,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { PageHeader, PageShell } from "@/components/PageShell";
import ScoreRing from "@/components/ui/ScoreRing";
import { CountUp, EASE_OUT, FadeIn, HoverCard, SpotlightCard, Stagger } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { matchMentors } from "@/lib/api";
import { getStoredProfile, setStoredMatches } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { toStartupProfilePayload } from "@/components/matches/matchData";

const DEFAULT_CONFIDENCE = 75;
const MAX_LIST_ITEMS = 4;

/** Backend stage values are "idea" | "MVP" | "growth"; match case-insensitively. */
const STAGE_STYLES = {
  idea: { label: "Idea", variant: "info" },
  mvp: { label: "MVP", variant: "warning" },
  growth: { label: "Growth", variant: "success" },
};
const STAGE_TRACK = ["idea", "mvp", "growth"];

function StageBadge({ stage }) {
  const style = STAGE_STYLES[String(stage || "").toLowerCase()];
  return (
    <Badge variant={style?.variant || "outline"} className="h-7 px-3 text-sm">
      {style?.label || stage || "Unknown"}
    </Badge>
  );
}

/** Idea → MVP → Growth track with the startup's stage lit up. */
function StageTrack({ stage }) {
  const current = STAGE_TRACK.indexOf(String(stage || "").toLowerCase());
  return (
    <div aria-hidden="true" className="mt-6">
      <div className="relative mx-2 h-1 rounded-full bg-muted">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_50%)]"
          initial={{ width: 0 }}
          animate={{ width: current <= 0 ? "0%" : `${(current / (STAGE_TRACK.length - 1)) * 100}%` }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 }}
        />
        {STAGE_TRACK.map((key, i) => (
          <motion.span
            key={key}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.3 + i * 0.12 }}
            className={cn(
              "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
              i <= current ? "border-primary bg-primary" : "border-border bg-card",
              i === current && "shadow-[0_0_0_5px_color-mix(in_oklch,var(--primary)_22%,transparent)]"
            )}
            style={{ left: `${(i / (STAGE_TRACK.length - 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[11px] font-medium">
        {STAGE_TRACK.map((key, i) => (
          <span key={key} className={i === current ? "text-foreground" : "text-muted-foreground"}>
            {STAGE_STYLES[key].label}
          </span>
        ))}
      </div>
    </div>
  );
}

function FieldCard({ icon: Icon, label, className, children }) {
  return (
    <HoverCard className={className}>
      <SpotlightCard className="h-full p-5 sm:p-6">
        <p className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          {label}
        </p>
        <div className="mt-4">{children}</div>
      </SpotlightCard>
    </HoverCard>
  );
}

function BulletList({ items, emptyLabel }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const shown = items.slice(0, MAX_LIST_ITEMS);
  const extra = items.length - shown.length;
  return (
    <>
      <ul className="space-y-2.5 text-sm text-foreground">
        {shown.map((item, i) => (
          <li key={i} className="flex items-start gap-3 break-words">
            <span
              aria-hidden="true"
              className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-medium text-muted-foreground"
            >
              {i + 1}
            </span>
            <span className="min-w-0 leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
      {extra > 0 && (
        <p className="mt-3 inline-flex rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
          +{extra} more
        </p>
      )}
    </>
  );
}

function SignalList({ items, tone }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const strong = tone === "strong";
  const Icon = strong ? CheckCircle2 : AlertTriangle;
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {strong ? "Strong signals" : "Weak signals"}
      </p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm",
              strong ? "border-success/20 bg-success/8" : "border-warning/20 bg-warning/8"
            )}
          >
            <Icon
              className={cn("mt-0.5 size-4 shrink-0", strong ? "text-success" : "text-warning")}
              aria-hidden="true"
            />
            <span className="break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function ConfidenceCard({ feedback }) {
  const hasFeedback = Boolean(feedback && typeof feedback === "object");
  const score = hasFeedback ? clampScore(feedback.confidence_score) : DEFAULT_CONFIDENCE;
  const tips = hasFeedback && Array.isArray(feedback.improvement_tips) ? feedback.improvement_tips : [];

  return (
    <div className="surface relative overflow-hidden rounded-3xl p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/15 blur-3xl"
      />
      <p className="eyebrow relative">Match confidence</p>
      <div className="relative mt-5 flex flex-col items-center text-center">
        <ScoreRing
          value={score}
          size={136}
          stroke={10}
          thresholds="confidence"
          label={`Match confidence ${score} out of 100`}
        >
          <span className="flex flex-col items-center">
            <span className="text-3xl font-semibold tracking-tight">
              <CountUp value={score} />
            </span>
            <span className="font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              of 100
            </span>
          </span>
        </ScoreRing>
        <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {hasFeedback
            ? "How well a mentor can judge fit from what your deck tells us."
            : "Estimated from your profile. Re-upload your deck for detailed feedback."}
        </p>
      </div>

      {hasFeedback && (
        <div className="relative mt-6 space-y-5">
          <SignalList items={feedback.strong_signals} tone="strong" />
          <SignalList items={feedback.weak_signals} tone="weak" />
        </div>
      )}

      {tips.length > 0 && (
        <Accordion className="relative mt-4">
          <AccordionItem value="tips">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <Lightbulb className="size-4 text-spark" aria-hidden="true" />
                How to improve
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ol className="space-y-2.5">
                {tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      aria-hidden="true"
                      className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-spark/14 font-mono text-[10px] font-semibold text-spark"
                    >
                      {i + 1}
                    </span>
                    <span>
                      <span className="sr-only">{i + 1}. </span>
                      {tip}
                    </span>
                  </li>
                ))}
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

function FieldCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={cn("surface rounded-2xl p-6", i === 0 && "sm:col-span-2")}
        >
          <Skeleton className="mb-5 h-4 w-24" />
          <Skeleton className="mb-2.5 h-6 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // getStoredProfile() returns null for a missing *or* malformed profile;
    // either way there's nothing to review, so send the user back to upload.
    const stored = getStoredProfile();
    if (!stored) {
      toast.info("Please upload your pitch deck first", { id: "profile-missing" });
      router.replace("/upload");
      return;
    }
    setProfile(stored);
  }, [router]);

  async function handleFindMentors() {
    if (!profile || loading) return;
    setLoading(true);
    try {
      // /match takes a StartupProfile only — never send deck_feedback.
      const data = await matchMentors(toStartupProfilePayload(profile));
      const matches = Array.isArray(data) ? data : data?.matches || [];
      setStoredMatches(matches);
      router.push("/matches");
    } catch (err) {
      // Network failures already raised the "Server unavailable" toast.
      if (err.status !== 0) {
        toast.error(err.message || "Something went wrong finding your mentors.");
      }
      setLoading(false);
    }
  }

  // Hydrating (or redirecting away).
  if (!profile) {
    return (
      <PageShell key="loading" width="full">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="mb-3 h-10 w-80 max-w-full" />
        <Skeleton className="mb-12 h-5 w-full max-w-md" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <FieldCardsSkeleton />
          <Skeleton className="h-96 w-full rounded-3xl" />
        </div>
      </PageShell>
    );
  }

  const { domain, stage, challenges, team_gaps: teamGaps, geography, deck_feedback: feedback } = profile;
  const hasFeedback = Boolean(feedback && typeof feedback === "object");
  const score = hasFeedback ? clampScore(feedback.confidence_score) : DEFAULT_CONFIDENCE;

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Step 2 of 3 · Review"
        title={
          <>
            Here&apos;s what we{" "}
            <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
              understood
            </span>
          </>
        }
        description="Review your profile before we find your matches."
        actions={
          <Button variant="outline" render={<Link href="/upload" />}>
            <RefreshCw aria-hidden="true" />
            Re-upload
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Extracted profile, as a bento grid */}
        <div className="min-w-0">
          {loading ? (
            <FieldCardsSkeleton />
          ) : (
            <Stagger className="grid gap-4 sm:grid-cols-2" stagger={0.08}>
              <FieldCard icon={Globe2} label="Domain" className="sm:col-span-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <p className="break-words text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    {domain || "Unknown"}
                  </p>
                  {geography && (
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-sm text-muted-foreground">
                      <MapPin className="size-3.5 text-primary" aria-hidden="true" />
                      {geography}
                    </span>
                  )}
                </div>
              </FieldCard>

              <FieldCard icon={Layers} label="Stage" className="sm:col-span-2">
                <div className="flex flex-wrap items-center gap-3">
                  <StageBadge stage={stage} />
                </div>
                <StageTrack stage={stage} />
              </FieldCard>

              <FieldCard icon={Target} label="Challenges">
                <BulletList items={challenges} emptyLabel="None identified in your deck." />
              </FieldCard>

              <FieldCard icon={Users} label="Team Gaps">
                <BulletList items={teamGaps} emptyLabel="None identified in your deck." />
              </FieldCard>
            </Stagger>
          )}
        </div>

        {/* Sticky confidence column */}
        <aside className="min-w-0" aria-label="Match confidence">
          <FadeIn className="lg:sticky lg:top-24">
            <ConfidenceCard feedback={hasFeedback ? feedback : null} />
          </FadeIn>
        </aside>
      </div>

      <Stagger className="mt-8 space-y-4">
        {hasFeedback && score < 50 && (
          <FadeIn
            role="status"
            className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              Limited deck detail — matches may be less accurate
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" render={<Link href="/upload" />}>
                Re-upload
              </Button>
              <Button size="sm" onClick={handleFindMentors} disabled={loading}>
                Continue Anyway →
              </Button>
            </div>
          </FadeIn>
        )}
        {hasFeedback && score >= 80 && (
          <FadeIn
            role="status"
            className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-3.5 text-sm text-foreground"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            Great detail — your matches will be highly targeted
          </FadeIn>
        )}

        <FadeIn className="surface relative overflow-hidden rounded-3xl p-5 sm:p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_left,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_60%)]"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Sparkles className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold text-foreground">Looks right? Let&apos;s find your mentors.</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  We rank every mentor by domain fit, stage and track record.
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={handleFindMentors}
              disabled={loading}
              size="lg"
              className="w-full sm:w-auto"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {loading ? "Finding your mentors…" : "Find My Mentors"}
              {!loading && (
                <ArrowRight
                  className="transition-transform group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              )}
            </Button>
          </div>
        </FadeIn>
        <p aria-live="polite" className="sr-only">
          {loading ? "Finding your mentor matches" : ""}
        </p>
      </Stagger>
    </PageShell>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard requiredRole="startup">
      <ProfilePageContent />
    </AuthGuard>
  );
}
