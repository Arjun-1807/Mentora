"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Mail,
  RefreshCw,
  Star,
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
import { Progress } from "@/components/ui/progress";
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
import DashboardShell, { useTabParam } from "@/components/dashboard/DashboardShell";
import HealthScoreCard from "@/components/dashboard/HealthScoreCard";
import HealthLogDialog from "@/components/dashboard/HealthLogDialog";
import PostMeetingBanner from "@/components/dashboard/PostMeetingBanner";
import CalendarConnectCard from "@/components/dashboard/CalendarConnect";
import MetricsPanel from "@/components/dashboard/MetricsPanel";
import {
  dateLabel,
  sameMatch,
  scorePercent,
  statusOf,
  withHealthLogged,
} from "@/components/dashboard/helpers";
import EmailDialog from "@/components/matches/EmailDialog";
import BookingDialog from "@/components/matches/BookingDialog";
import {
  getDashboardStats,
  getFeedbackSummary,
  listMatches,
  listMentors,
  logFeedback,
} from "@/lib/api";
import { setStoredMatches } from "@/lib/storage";

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

/** Statuses that mean an intro request was actually sent for this match. */
const SENT_STATUSES = new Set([
  "requested", "accepted", "declined", "withdrawn", "expired", "meeting_scheduled", "met", "completed",
]);
const ACCEPTED_STATUSES = new Set(["accepted", "meeting_scheduled", "met", "completed"]);
/** Feedback (rating) can be logged once a meeting was booked (POST /feedback gate). */
const FEEDBACK_STATUSES = new Set(["meeting_scheduled", "met"]);

/** `email_sent_at` is stamped when POST /matches/{id}/request sends the intro. */
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

function ScoreBar({ score }) {
  const pct = scorePercent(score);
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-28 items-center gap-2">
      <Progress value={pct} className="flex-1" aria-label={`Match score ${pct}%`} />
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log outcome</DialogTitle>
          <DialogDescription>
            Record what happened with {mentorName || "this mentor"}. This feeds back into how
            mentors are ranked, and can only be submitted once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="attended-switch">Meeting attended</Label>
            <Switch
              id="attended-switch"
              checked={attended}
              onCheckedChange={setAttended}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
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

function TableSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
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
      actions={<Button render={<Link href="/upload" />}>Upload a pitch deck</Button>}
      className="border-0 bg-transparent shadow-none ring-0"
    />
  );
}

/**
 * The next step for a match, as a row button: send the intro (suggested),
 * book a meeting (accepted), log the outcome (meeting booked / met).
 * `onAction(kind, match)` with kind "request" | "book" | "log".
 */
function RowAction({ match, name, onAction }) {
  const status = statusOf(match);
  const who = name || "this mentor";
  if (status === "suggested") {
    return (
      <Button type="button" size="sm" onClick={() => onAction("request", match)} aria-label={`Send intro to ${who}`}>
        <Mail aria-hidden="true" />
        Send intro
      </Button>
    );
  }
  if (status === "accepted") {
    return (
      <Button type="button" size="sm" onClick={() => onAction("book", match)} aria-label={`Book a meeting with ${who}`}>
        <CalendarCheck aria-hidden="true" />
        Book
      </Button>
    );
  }
  if (FEEDBACK_STATUSES.has(status)) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => onAction("log", match)}
        aria-label={`Log outcome for ${who}`}>
        Log Outcome
      </Button>
    );
  }
  const label = { requested: "Awaiting reply", completed: "Logged" }[status] || "—";
  return <span className="text-xs text-muted-foreground">{label}</span>;
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
  onAction,
}) {
  const recent = matches.slice(0, 5);
  const avg = typeof stats?.avg_rating === "number" ? Math.round(stats.avg_rating * 10) / 10 : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Users />} label="Total Matches" value={stats?.total_matches ?? 0} loading={statsLoading} />
        <StatCard icon={<Mail />} label="Emails Sent" value={stats?.emails_sent ?? 0} loading={statsLoading} />
        <StatCard
          icon={<CalendarCheck />}
          label="Meetings Accepted"
          value={stats?.meetings_accepted ?? 0}
          loading={statsLoading}
        />
        <StatCard
          icon={<Star />}
          label="Avg Rating"
          value={avg ?? "—"}
          trend={avg !== null ? "Out of 5" : "No feedback logged yet"}
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <HealthScoreCard refreshKey={healthKey} className="lg:col-span-2" />
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
                New pitch deck?
              </CardTitle>
              <CardDescription>Re-run matching with an updated deck.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" render={<Link href="/upload" />}>
                Upload New Deck
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
          <CalendarConnectCard />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Recent matches</CardTitle>
            <CardDescription className="mt-1">Your five most recent mentor matches.</CardDescription>
          </div>
          {matches.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={onViewAll}>
              View all
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {matchesLoading ? (
            <TableSkeleton rows={3} />
          ) : matchesError ? (
            <InlineError message={matchesError}>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Try again
              </Button>
            </InlineError>
          ) : recent.length === 0 ? (
            <EmptyMatches />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mentor</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="text-right">Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((match, i) => {
                  const pct = scorePercent(match.score ?? match.match_score);
                  return (
                    <TableRow key={match.match_id || `${match.mentor_id}-${i}`}>
                      <TableCell className="max-w-[12rem] truncate font-medium">{nameOf(match, "Unknown mentor")}</TableCell>
                      <TableCell className="tabular-nums">{pct === null ? "—" : `${pct}%`}</TableCell>
                      <TableCell>
                        <StatusBadge status={statusOf(match)} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {dateLabel(match.updated_at || match.timestamp)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowAction match={match} name={nameOf(match, null)} onAction={onAction} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MatchesTab({ matches, loading, error, nameOf, onRetry, onAction }) {
  return (
    <Card>
      <CardContent>
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <InlineError message={error}>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </InlineError>
        ) : matches.length === 0 ? (
          <EmptyMatches />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Startup</TableHead>
                <TableHead>Mentor</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((match, i) => {
                const status = statusOf(match);
                const { rating } = feedbackOf(match);
                const name = nameOf(match, null);
                return (
                  <TableRow key={match.match_id || `${match.mentor_id}-${i}`}>
                    <TableCell className="max-w-[10rem] truncate">
                      {match.startup_profile?.domain || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      {name ? (
                        <span className="block truncate font-medium">{name}</span>
                      ) : (
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {match.mentor_id || "unknown"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ScoreBar score={match.score ?? match.match_score} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {typeof rating === "number" ? `${rating}/5` : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateLabel(match.updated_at || match.timestamp)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowAction match={match} name={name} onAction={onAction} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
  const [requestMatch, setRequestMatch] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [bookMatch, setBookMatch] = useState(null);
  const [bookOpen, setBookOpen] = useState(false);

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

    listMatches()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.matches || [];
        setMatches([...list].sort((a, b) => matchTime(b) - matchTime(a)));
        setStoredMatches(list); // cache only; the API stays the source of truth
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
      setMatches((prev) =>
        prev.map((m) => {
          if (!sameMatch(m, match)) return m;
          const logged = withHealthLogged(m, "startup");
          // The first outcome log marks the meeting as met (server side).
          return statusOf(logged) === "meeting_scheduled" ? { ...logged, status: "met" } : logged;
        })
      );
      setHealthKey((k) => k + 1);
      loadStats();
    },
    [loadStats]
  );

  const handleAction = useCallback((kind, match) => {
    if (kind === "request") {
      setRequestMatch(match);
      setRequestOpen(true);
    } else if (kind === "book") {
      setBookMatch(match);
      setBookOpen(true);
    } else {
      setFeedbackMatch(match);
      setFeedbackOpen(true);
    }
  }, []);

  const replaceMatch = useCallback(
    (next) => {
      if (!next) return;
      setMatches((prev) => prev.map((m) => (sameMatch(m, next) ? { ...m, ...next } : m)));
      loadStats();
    },
    [loadStats]
  );

  // Stable objects: EmailDialog re-drafts (an LLM call) whenever `mentor` changes.
  const requestMentor = useMemo(
    () => (requestMatch ? { ...requestMatch, name: requestMatch.name || nameOf(requestMatch, "your mentor") } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestMatch]
  );
  const bookingMatch = useMemo(
    () => (bookMatch ? { ...bookMatch, name: bookMatch.name || nameOf(bookMatch, "your mentor") } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookMatch]
  );

  const copy = TAB_COPY[tab];
  const refreshing = matchesLoading || statsLoading;

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

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>
        {tab !== "metrics" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReloadKey((k) => k + 1);
              setHealthKey((k) => k + 1);
            }}
            disabled={refreshing}
            className="self-start sm:self-auto"
          >
            {refreshing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Refresh
          </Button>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
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
              onAction={handleAction}
            />
          )}
          {tab === "matches" && (
            <MatchesTab
              matches={matches}
              loading={matchesLoading}
              error={matchesError}
              nameOf={nameOf}
              onRetry={() => setReloadKey((k) => k + 1)}
              onAction={handleAction}
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
      <EmailDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        mentor={requestMentor}
        onSent={replaceMatch}
      />
      <BookingDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        match={bookingMatch}
        onBooked={(match, meeting) => replaceMatch({ ...match, status: "meeting_scheduled", meeting })}
      />
    </DashboardShell>
  );
}

function ShellFallback() {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
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
