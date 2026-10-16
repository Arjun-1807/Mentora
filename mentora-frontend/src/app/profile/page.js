"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Layers,
  Lightbulb,
  Loader2,
  MapPin,
  Target,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import ScoreRing from "@/components/ui/ScoreRing";
import { Stagger, HoverCard, FadeIn } from "@/components/motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
  idea: { label: "Idea", className: "border-blue-500/30 bg-blue-500/15 text-blue-300" },
  mvp: { label: "MVP", className: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  growth: { label: "Growth", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
};

function StageBadge({ stage }) {
  const style = STAGE_STYLES[String(stage || "").toLowerCase()];
  return (
    <Badge variant="outline" className={cn("h-6 px-2.5 text-sm", style?.className)}>
      {style?.label || stage || "Unknown"}
    </Badge>
  );
}

function FieldCard({ icon: Icon, label, children }) {
  return (
    <HoverCard>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
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
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground marker:text-primary">
        {shown.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>
      {extra > 0 && <p className="mt-2 text-xs text-muted-foreground">+{extra} more</p>}
    </>
  );
}

function SignalList({ items, tone }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const Icon = tone === "strong" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tone === "strong" ? "Strong signals" : "Weak signals"}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                tone === "strong" ? "text-emerald-400" : "text-amber-400"
              )}
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Match Confidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <ScoreRing
            value={score}
            size={88}
            stroke={7}
            thresholds="confidence"
            label={`Match confidence ${score} out of 100`}
          >
            <span className="text-xl font-bold tabular-nums">{score}</span>
          </ScoreRing>
          <p className="text-sm text-muted-foreground">
            {hasFeedback
              ? "How well a mentor can judge fit from what your deck tells us."
              : "Estimated from your profile. Re-upload your deck for detailed feedback."}
          </p>
        </div>

        {hasFeedback && (
          <>
            <SignalList items={feedback.strong_signals} tone="strong" />
            <SignalList items={feedback.weak_signals} tone="weak" />
          </>
        )}

        {tips.length > 0 && (
          <Accordion>
            <AccordionItem value="tips">
              <AccordionTrigger>How to improve</AccordionTrigger>
              <AccordionContent>
                <ol className="space-y-2">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                      <span>
                        <span className="mr-1 font-semibold tabular-nums">{i + 1}.</span>
                        {tip}
                      </span>
                    </li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function FieldCardsSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="py-2">
            <Skeleton className="mb-4 h-4 w-24" />
            <Skeleton className="mb-2 h-6 w-40" />
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
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
      <PageWrapper key="loading">
        <div className="grid gap-8 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-5 w-full max-w-md" />
            <FieldCardsSkeleton />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  const { domain, stage, challenges, team_gaps: teamGaps, geography, deck_feedback: feedback } = profile;
  const hasFeedback = Boolean(feedback && typeof feedback === "object");
  const score = hasFeedback ? clampScore(feedback.confidence_score) : DEFAULT_CONFIDENCE;

  return (
    <PageWrapper>
      <div className="grid gap-8 lg:grid-cols-5">
        {/* Left — extracted profile (60%) */}
        <div className="min-w-0 lg:col-span-3">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Here&apos;s what we understood</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review your profile before we find your matches.
              </p>
            </div>
            <Button variant="ghost" size="sm" render={<Link href="/upload" />} className="shrink-0">
              Re-upload
            </Button>
          </div>

          {loading ? (
            <FieldCardsSkeleton />
          ) : (
            <Stagger className="grid gap-5 sm:grid-cols-2" stagger={0.08}>
              <FieldCard icon={Globe2} label="Domain">
                <p className="break-words text-xl font-bold text-foreground">{domain || "Unknown"}</p>
              </FieldCard>

              <FieldCard icon={Layers} label="Stage">
                <div className="flex flex-wrap items-center gap-3">
                  <StageBadge stage={stage} />
                  {geography && (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {geography}
                    </span>
                  )}
                </div>
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

        {/* Right — sticky confidence sidebar (40%) */}
        <aside className="min-w-0 lg:col-span-2" aria-label="Match confidence">
          <div className="lg:sticky lg:top-24">
            <ConfidenceCard feedback={hasFeedback ? feedback : null} />
          </div>
        </aside>
      </div>

      <Stagger className="mt-8 space-y-4">
        {hasFeedback && score < 50 && (
          <FadeIn
            role="status"
            className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex items-start gap-2 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
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
            className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Great detail — your matches will be highly targeted
          </FadeIn>
        )}

        <FadeIn>
          <Button
            type="button"
            onClick={handleFindMentors}
            disabled={loading}
            size="lg"
            className="h-11 w-full text-base"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? "Finding your mentors…" : "Find My Mentors →"}
          </Button>
        </FadeIn>
        <p aria-live="polite" className="sr-only">
          {loading ? "Finding your mentor matches" : ""}
        </p>
      </Stagger>
    </PageWrapper>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard requiredRole="startup">
      <ProfilePageContent />
    </AuthGuard>
  );
}
