"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Mail,
  RefreshCw,
  Star,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { StateCard, InlineError } from "@/components/StateCard";
import { StarRating } from "@/components/StarRating";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CountUp, EASE_OUT, FadeIn, SPRING, Stagger } from "@/components/motion";
import { LogoMark } from "@/components/brand/Logo";
import DashboardShell, { useTabParam } from "@/components/dashboard/DashboardShell";
import HealthScoreCard from "@/components/dashboard/HealthScoreCard";
import HealthLogDialog from "@/components/dashboard/HealthLogDialog";
import PostMeetingBanner from "@/components/dashboard/PostMeetingBanner";
import CalendarConnectCard from "@/components/dashboard/CalendarConnect";
import MetricsPanel from "@/components/dashboard/MetricsPanel";
import {
  dateLabel,
  initialsOf,
  sameMatch,
  scorePercent,
  statusOf,
  withHealthLogged,
} from "@/components/dashboard/helpers";
import {
  getAllMatches,
  getDashboardStats,
  getFeedbackSummary,
  listMentors,
  logFeedback,
} from "@/lib/api";
import { getUserEmail } from "@/lib/storage";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "matches", label: "Matches", icon: ListChecks },
  { id: "metrics", label: "Metrics", icon: BarChart3 },
];
const TAB_IDS = TABS.map((t) => t.id);

const TAB_COPY = {
  overview: {
    title: "Overview",
    description: "Your mentor matches, intros and meetings at a glance.",
  },
  matches: {
    title: "Matches",
    description: "Every mentor match, its status, and how each one turned out.",
  },
  metrics: {
    title: "Metrics",
    description: "Measure how well Mentora ranks the mentors you know are right.",
  },
};

/** Statuses that mean an intro email was actually delivered for this match. */
const SENT_STATUSES = new Set(["email_sent", "sent", "accepted", "declined", "meeting_scheduled"]);
const ACCEPTED_STATUSES = new Set(["accepted", "meeting_scheduled", "completed"]);

/**
 * A "completed" match may or may not have had an intro sent through Mentora,
 * so `email_sent_at` (stamped by POST /feedback-status) is the reliable signal.
 */
function introSent(match) {
  return Boolean(match?.email_sent_at) || SENT_STATUSES.has(statusOf(match));
}

/**
 * Reads whatever feedback is attached to a match record (`feedback: {...}` or
 * flat fields), falling back to what was submitted in this session.
 */
function feedbackOf(match) {
  const nested = match?.feedback && typeof match.feedback === "object" ? match.feedback : {};
  const rating = [match?.rating, nested.rating].find((r) => typeof r === "number" && !Number.isNaN(r));
  const attended = [match?.attended, nested.attended].find((a) => typeof a === "boolean");
  return { rating: rating ?? null, attended: attended ?? null };
}

function matchTime(match) {
  const t = new Date(match?.updated_at || match?.timestamp || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Client-side stand-in for GET /dashboard/stats, used only if that endpoint
 * fails (e.g. an older backend). Mirrors the pre-revamp dashboard's logic.
 */
function fallbackStats(matches, mentorRatings) {
  const ratings = matches.map((m) => feedbackOf(m).rating).filter((r) => typeof r === "number" && r > 0);
  const usable = ratings.length
    ? ratings
    : matches
        .filter((m) => statusOf(m) === "completed")
        .map((m) => mentorRatings[m.mentor_id])
        .filter((r) => typeof r === "number" && r > 0);
  return {
    total_matches: matches.length,
    emails_sent: matches.filter(introSent).length,
    meetings_accepted: matches.filter(
      (m) => ACCEPTED_STATUSES.has(statusOf(m)) || feedbackOf(m).attended === true
    ).length,
    avg_rating: usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null,
  };
}


/* ------------------------------------------------------------ presentation */

/** "Good morning" / "Good afternoon" / "Good evening" for the local time. */
function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** A friendly first name from the signed-in email ("asha.k@x.com" -> "Asha"). */
function useFirstName() {
  const [name, setName] = useState("");
  // localStorage is client-only: read it after mount.
  useEffect(() => {
    const local = String(getUserEmail() || "").split("@")[0].split(/[._\-+\d]+/)[0];
    setName(local ? local[0].toUpperCase() + local.slice(1) : "");
  }, []);
  return name;
}

function MentorAvatar({ name, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-xs font-semibold text-primary",
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Match score as a slim gradient meter plus the number. */
function ScoreBar({ score }) {
  const pct = scorePercent(score);
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-28 items-center gap-2.5">
      <div
        role="meter"
        aria-label={`Match score ${pct}%`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_45%)]"
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        />
      </div>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

/** Rounded mono pill for a percentage score in compact lists. */
function ScorePill({ score }) {
  const pct = scorePercent(score);
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
      {pct}%
    </span>
  );
}

/* ---------------------------------------------------------- feedback dialog */

function LogFeedbackDialog({ open, onOpenChange, match, mentorName, onSubmitted }) {
  const [attended, setAttended] = useState(false);
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setAttended(false);
      setRating(0);
      setError("");
    }
  }, [open]);

  const missingIds = !match?.match_id || !match?.mentor_id;

  async function handleSubmit() {
    if (!match || submitting) return;
    if (rating < 1) {
      setError("Pick a satisfaction rating from 1 to 5.");
      return;
    }
    if (missingIds) {
      setError("This match record is missing its ids, so feedback can't be linked to it.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await logFeedback({
        match_id: match.match_id,
        mentor_id: match.mentor_id,
        attended,
        rating,
      });
      toast.success("Outcome logged.");
      onSubmitted?.(match, { attended, rating });
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Could not log this outcome.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]">
            <ClipboardCheck className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle className="text-lg">Log outcome</DialogTitle>
          <DialogDescription>
            Record what happened with {mentorName || "this mentor"}. This feeds back into how
            mentors are ranked, and can only be submitted once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 px-4 py-3.5">
            <Label htmlFor="attended-switch" className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              Meeting attended
            </Label>
            <Switch
              id="attended-switch"
              checked={attended}
              onCheckedChange={setAttended}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2.5 rounded-2xl border border-border bg-muted/30 px-4 py-3.5">
            <Label htmlFor="satisfaction-rating">Satisfaction rating</Label>
            <StarRating
              id="satisfaction-rating"
              label="Satisfaction rating, 1 to 5 stars"
              value={rating}
              onChange={setRating}
              disabled={submitting}
            />
          </div>
          {error && <InlineError message={error} />}
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={submitting || rating < 1}>
            {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- tab bodies */

function ListSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function EmptyMatches() {
  return (
    <StateCard
      icon={LayoutDashboard}
      title="No matches recorded yet"
      description="Upload a pitch deck and run the matching — every match shows up here so you can track the outcome."
      actions={
        <Button render={<Link href="/upload" />}>
          <Upload aria-hidden="true" />
          Upload a pitch deck
        </Button>
      }
      variant="plain"
    />
  );
}

/**
 * Matches → intros → meetings, as three bars sized against the total.
 * Built only from the dashboard counters; shows conversion between steps.
 */
function FunnelCard({ stats, loading }) {
  const total = stats?.total_matches ?? 0;
  const steps = [
    { label: "Matches", value: total, icon: Users, color: "var(--chart-1)" },
    { label: "Intros sent", value: stats?.emails_sent ?? 0, icon: Mail, color: "var(--chart-5)" },
    {
      label: "Meetings",
      value: stats?.meetings_accepted ?? 0,
      icon: CalendarCheck,
      color: "var(--chart-3)",
    },
  ];
  const meetingRate = total > 0 ? Math.round(((stats?.meetings_accepted ?? 0) / total) * 100) : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-info/12 text-info">
            <TrendingUp className="size-4" aria-hidden="true" />
          </span>
          Your pipeline
        </CardTitle>
        <CardDescription>From match to meeting.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {loading ? (
          <div className="space-y-4">
            {steps.map((s) => (
              <Skeleton key={s.label} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <ol className="space-y-4">
              {steps.map((step, i) => {
                const Icon = step.icon;
                const pct = total > 0 ? Math.max(4, Math.round((step.value / total) * 100)) : 0;
                return (
                  <li key={step.label}>
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden="true" />
                        {step.label}
                      </span>
                      <span className="font-semibold text-foreground">
                        <CountUp value={step.value} />
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: step.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.15 + i * 0.12 }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-auto pt-5 text-xs text-muted-foreground">
              {meetingRate === null ? (
                "Run your first match to start the pipeline."
              ) : (
                <>
                  <span className="font-mono font-semibold text-foreground">{meetingRate}%</span>{" "}
                  of matches turned into a meeting.
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Gradient call-to-action for re-running matching with a new deck. */
function UploadCta() {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_22%,var(--card))_0%,var(--card)_60%,color-mix(in_oklch,var(--spark)_14%,var(--card))_100%)] p-5 shadow-soft">
      <div
        aria-hidden="true"
        className="absolute -right-10 -top-10 -z-10 size-36 rounded-full bg-primary/25 blur-3xl"
      />
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card/80 text-primary shadow-soft">
          <FileUp className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold tracking-tight text-foreground">New pitch deck?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Re-run matching with an updated deck.</p>
        </div>
      </div>
      <Button size="sm" className="group mt-4" render={<Link href="/upload" />}>
        Upload New Deck
        <ArrowRight
          className="transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}

function OverviewTab({
  stats,
  statsLoading,
  matches,
  matchesLoading,
  matchesError,
  nameOf,
  healthKey,
  onRetry,
  onViewAll,
}) {
  const recent = matches.slice(0, 5);
  const avg = typeof stats?.avg_rating === "number" ? Math.round(stats.avg_rating * 10) / 10 : null;

  return (
    <Stagger className="space-y-5" stagger={0.07}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FadeIn>
          <StatCard
            icon={<Users />}
            label="Total Matches"
            value={stats?.total_matches ?? 0}
            loading={statsLoading}
          />
        </FadeIn>
        <FadeIn>
          <StatCard
            icon={<Mail />}
            label="Emails Sent"
            value={stats?.emails_sent ?? 0}
            loading={statsLoading}
            tone="info"
          />
        </FadeIn>
        <FadeIn>
          <StatCard
            icon={<CalendarCheck />}
            label="Meetings Accepted"
            value={stats?.meetings_accepted ?? 0}
            loading={statsLoading}
            tone="success"
          />
        </FadeIn>
        <FadeIn>
          <StatCard
            icon={<Star />}
            label="Avg Rating"
            value={avg ?? "—"}
            trend={avg !== null ? "Out of 5" : "No feedback logged yet"}
            loading={statsLoading}
            tone="spark"
          />
        </FadeIn>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FadeIn className="lg:col-span-2">
          <HealthScoreCard refreshKey={healthKey} />
        </FadeIn>
        <FadeIn>
          <FunnelCard stats={stats} loading={statsLoading} />
        </FadeIn>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FadeIn className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Recent matches</CardTitle>
                <CardDescription className="mt-1">Your five most recent mentor matches.</CardDescription>
              </div>
              {matches.length > 0 && (
                <Button type="button" size="sm" variant="ghost" onClick={onViewAll} className="group">
                  View all
                  <ArrowRight
                    className="transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {matchesLoading ? (
                <ListSkeleton rows={3} />
              ) : matchesError ? (
                <InlineError message={matchesError}>
                  <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                    Try again
                  </Button>
                </InlineError>
              ) : recent.length === 0 ? (
                <EmptyMatches />
              ) : (
                <ul className="-mx-2 divide-y divide-border">
                  {recent.map((match, i) => {
                    const name = nameOf(match, "Unknown mentor");
                    return (
                      <motion.li
                        key={match.match_id || `${match.mentor_id}-${i}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.05 * i }}
                        className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/40"
                      >
                        <MentorAvatar name={name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {dateLabel(match.updated_at || match.timestamp)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                          <ScorePill score={match.score ?? match.match_score} />
                          <StatusBadge status={statusOf(match)} />
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </FadeIn>
        <FadeIn className="flex flex-col gap-4">
          <UploadCta />
          <CalendarConnectCard className="flex-1" />
        </FadeIn>
      </div>
    </Stagger>
  );
}

function OutcomeButton({ match, name, done, onLog }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={done ? "ghost" : "outline"}
      onClick={() => onLog(match)}
      disabled={done}
      aria-label={
        done ? `Outcome logged for ${name || "this match"}` : `Log outcome for ${name || "this match"}`
      }
    >
      {done && <CheckCircle2 className="text-success" aria-hidden="true" />}
      {done ? "Logged" : "Log Outcome"}
    </Button>
  );
}

function MatchesTab({ matches, loading, error, nameOf, onRetry, onLog }) {
  if (loading || error || matches.length === 0) {
    return (
      <Card>
        <CardContent>
          {loading ? (
            <ListSkeleton />
          ) : error ? (
            <InlineError message={error}>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Try again
              </Button>
            </InlineError>
          ) : (
            <EmptyMatches />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* md and up: full table. */}
      <Card className="hidden gap-0 py-0 md:flex">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                {["Startup", "Mentor", "Score", "Status", "Rating", "Date"].map((h) => (
                  <TableHead
                    key={h}
                    className="h-11 px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    {h}
                  </TableHead>
                ))}
                <TableHead className="h-11 px-4 text-right font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((match, i) => {
                const status = statusOf(match);
                const done = status === "completed";
                const { rating } = feedbackOf(match);
                const name = nameOf(match, null);
                return (
                  <TableRow
                    key={match.match_id || `${match.mentor_id}-${i}`}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <TableCell className="max-w-[10rem] truncate px-4 py-3">
                      {match.startup_profile?.domain || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[14rem] px-4 py-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <MentorAvatar name={name || match.mentor_id} className="size-7 rounded-lg text-[10px]" />
                        {name ? (
                          <span className="block truncate font-medium">{name}</span>
                        ) : (
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {match.mentor_id || "unknown"}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <ScoreBar score={match.score ?? match.match_score} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {typeof rating === "number" ? (
                        <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
                          <Star className="size-3.5 fill-spark text-spark" aria-hidden="true" />
                          {rating}/5
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {dateLabel(match.updated_at || match.timestamp)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <OutcomeButton match={match} name={name} done={done} onLog={onLog} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Below md: one card per match. */}
      <Stagger as="ul" className="space-y-3 md:hidden" stagger={0.05}>
        {matches.map((match, i) => {
          const status = statusOf(match);
          const done = status === "completed";
          const { rating } = feedbackOf(match);
          const name = nameOf(match, null);
          return (
            <FadeIn
              as="li"
              key={match.match_id || `${match.mentor_id}-${i}`}
              className="surface rounded-2xl p-4"
            >
              <div className="flex items-start gap-3">
                <MentorAvatar name={name || match.mentor_id} />
                <div className="min-w-0 flex-1">
                  {name ? (
                    <p className="truncate font-medium text-foreground">{name}</p>
                  ) : (
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {match.mentor_id || "unknown"}
                    </p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {match.startup_profile?.domain || "—"} ·{" "}
                    <span className="font-mono">{dateLabel(match.updated_at || match.timestamp)}</span>
                  </p>
                </div>
                <StatusBadge status={status} />
              </div>
              <div className="mt-3">
                <ScoreBar score={match.score ?? match.match_score} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">
                  Rating{" "}
                  <span className="font-mono text-foreground">
                    {typeof rating === "number" ? `${rating}/5` : "—"}
                  </span>
                </span>
                <OutcomeButton match={match} name={name} done={done} onLog={onLog} />
              </div>
            </FadeIn>
          );
        })}
      </Stagger>
    </>
  );
}

/* ------------------------------------------------------------------- page */

function StartupDashboard() {
  const [tab, setTab] = useTabParam(TAB_IDS);

  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState("");
  const [apiStats, setApiStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [mentorNames, setMentorNames] = useState({});
  const [mentorRatings, setMentorRatings] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const [healthKey, setHealthKey] = useState(0);

  const [feedbackMatch, setFeedbackMatch] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [healthMatch, setHealthMatch] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);

  const loadStats = useCallback(() => {
    let cancelled = false;
    setStatsLoading(true);
    getDashboardStats()
      .then((data) => {
        if (cancelled) return;
        setApiStats(data || null);
        setStatsFailed(false);
      })
      .catch(() => {
        if (!cancelled) setStatsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMatchesLoading(true);
    setMatchesError("");

    getAllMatches()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.matches || [];
        setMatches([...list].sort((a, b) => matchTime(b) - matchTime(a)));
      })
      .catch((err) => {
        if (!cancelled) setMatchesError(err.message || "Could not load your matches.");
      })
      .finally(() => {
        if (!cancelled) setMatchesLoading(false);
      });

    // Optional enrichments for legacy match docs without `mentor_name`, and
    // for the fallback average rating. Failures just leave gaps.
    listMentors()
      .then((data) => {
        if (cancelled) return;
        const names = {};
        for (const mentor of data?.mentors || []) {
          if (mentor?.mentor_id) names[mentor.mentor_id] = mentor.name;
        }
        setMentorNames((prev) => ({ ...prev, ...names }));
      })
      .catch(() => {});

    getFeedbackSummary()
      .then((data) => {
        if (cancelled) return;
        const ratings = {};
        const names = {};
        for (const row of data?.mentors || []) {
          if (!row?.mentor_id) continue;
          if (typeof row.average_rating === "number") ratings[row.mentor_id] = row.average_rating;
          if (row.name) names[row.mentor_id] = row.name;
        }
        setMentorRatings(ratings);
        // Only fills gaps — /mentors is the better name source when present.
        setMentorNames((prev) => ({ ...names, ...prev }));
      })
      .catch(() => {});

    const cancelStats = loadStats();
    return () => {
      cancelled = true;
      cancelStats();
    };
  }, [reloadKey, loadStats]);

  const nameOf = useCallback(
    (match, fallback = "your mentor") => match?.mentor_name || mentorNames[match?.mentor_id] || fallback,
    [mentorNames]
  );

  const stats = useMemo(
    () => (statsFailed ? fallbackStats(matches, mentorRatings) : apiStats),
    [statsFailed, apiStats, matches, mentorRatings]
  );

  const handleFeedbackSubmitted = useCallback(
    (match, submitted) => {
      setMatches((prev) =>
        prev.map((m) => (sameMatch(m, match) ? { ...m, status: "completed", feedback: submitted } : m))
      );
      loadStats();
    },
    [loadStats]
  );

  const handleHealthLogged = useCallback(
    (match) => {
      setMatches((prev) => prev.map((m) => (sameMatch(m, match) ? withHealthLogged(m, "startup") : m)));
      setHealthKey((k) => k + 1);
      loadStats();
    },
    [loadStats]
  );

  const copy = TAB_COPY[tab];
  const refreshing = matchesLoading || statsLoading;
  const firstName = useFirstName();
  const today = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    []
  );

  return (
    <DashboardShell items={TABS} active={tab} onSelect={setTab} title="Startup dashboard">
      <PostMeetingBanner
        matches={matches}
        role="startup"
        nameOf={(m) => nameOf(m)}
        onLog={(m) => {
          setHealthMatch(m);
          setHealthOpen(true);
        }}
      />

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="min-w-0"
          >
            <p className="eyebrow mb-2">{tab === "overview" ? today : "Startup dashboard"}</p>
            {tab === "overview" ? (
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {greeting()}
                {firstName ? (
                  <>
                    ,{" "}
                    <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
                      {firstName}
                    </span>
                  </>
                ) : null}
                <span className="sr-only"> — {copy.title}</span>
              </h1>
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
            )}
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">{copy.description}</p>
          </motion.div>
        </AnimatePresence>
        {tab !== "metrics" && (
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReloadKey((k) => k + 1);
                setHealthKey((k) => k + 1);
              }}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <motion.span
                  className="flex"
                  whileHover={{ rotate: 180 }}
                  transition={SPRING.soft}
                >
                  <RefreshCw aria-hidden="true" />
                </motion.span>
              )}
              Refresh
            </Button>
            {tab === "overview" && (
              <Button size="sm" render={<Link href="/upload" />}>
                <Upload aria-hidden="true" />
                Upload deck
              </Button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          {tab === "overview" && (
            <OverviewTab
              stats={stats}
              statsLoading={statsLoading && !stats}
              matches={matches}
              matchesLoading={matchesLoading}
              matchesError={matchesError}
              nameOf={nameOf}
              healthKey={healthKey}
              onRetry={() => setReloadKey((k) => k + 1)}
              onViewAll={() => setTab("matches")}
            />
          )}
          {tab === "matches" && (
            <MatchesTab
              matches={matches}
              loading={matchesLoading}
              error={matchesError}
              nameOf={nameOf}
              onRetry={() => setReloadKey((k) => k + 1)}
              onLog={(m) => {
                setFeedbackMatch(m);
                setFeedbackOpen(true);
              }}
            />
          )}
          {tab === "metrics" && <MetricsPanel />}
        </motion.div>
      </AnimatePresence>

      <LogFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        match={feedbackMatch}
        mentorName={feedbackMatch ? nameOf(feedbackMatch, null) : null}
        onSubmitted={handleFeedbackSubmitted}
      />
      <HealthLogDialog
        open={healthOpen}
        onOpenChange={setHealthOpen}
        match={healthMatch}
        role="startup"
        counterpartName={healthMatch ? nameOf(healthMatch, null) : null}
        onLogged={handleHealthLogged}
      />
    </DashboardShell>
  );
}

function ShellFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-muted-foreground"
    >
      <span className="relative flex size-12 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-2 border-primary/15 border-t-primary"
        />
        <LogoMark className="size-7 rounded-lg" />
      </span>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard requiredRole="startup">
      {/* useSearchParams (tab sync) needs a Suspense boundary for `next build`. */}
      <Suspense fallback={<ShellFallback />}>
        <StartupDashboard />
      </Suspense>
    </AuthGuard>
  );
}
