"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { StateCard, InlineError } from "@/components/StateCard";
import { StarRating } from "@/components/StarRating";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, LayoutDashboard } from "lucide-react";
import {
  getAllMatches,
  getFeedbackSummary,
  listMentors,
  logFeedback,
} from "@/lib/api";

const STATUS_VARIANT = {
  pending: "secondary",
  emailed: "outline",
  completed: "default",
  // Legacy statuses, still rendered sensibly if older records show up.
  sent: "outline",
  accepted: "default",
  declined: "destructive",
};

const STATUS_LABEL = {
  pending: "Pending",
  emailed: "Emailed",
  completed: "Completed",
  sent: "Emailed",
  accepted: "Accepted",
  declined: "Declined",
};

/** Statuses that mean an intro email was drafted/handed off for this match. */
const EMAILED_STATUSES = new Set(["emailed", "sent", "accepted", "declined", "completed"]);

function statusOf(match) {
  return String(match?.status || "pending").toLowerCase();
}

/**
 * Reads whatever feedback is attached to a match record.
 *
 * `/matches/all` doesn't denormalize feedback onto the match documents today,
 * so this reads the shapes it might (`feedback: {...}` or flat fields) and
 * falls back to what we submitted in this session.
 */
function feedbackOf(match) {
  const nested = match?.feedback && typeof match.feedback === "object" ? match.feedback : {};
  const rating = [match?.rating, nested.rating].find(
    (r) => typeof r === "number" && !Number.isNaN(r)
  );
  const attended = [match?.attended, nested.attended].find((a) => typeof a === "boolean");
  return { rating: rating ?? null, attended: attended ?? null };
}

function scoreLabel(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)))}%`;
}

function timestampLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatCard({ label, value, hint, loading }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <p className="text-3xl font-bold text-foreground tabular-nums">{value}</p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LogOutcomeDialog({ open, onOpenChange, match, mentorName, onSubmitted }) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log outcome</DialogTitle>
          <DialogDescription>
            Record what happened with {mentorName || "this mentor"}. This feeds
            back into how mentors are ranked, and can only be submitted once.
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
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || rating < 1}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardPageContent() {
  const [matches, setMatches] = useState([]);
  const [mentorNames, setMentorNames] = useState({});
  const [mentorRatings, setMentorRatings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeMatch, setActiveMatch] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    getAllMatches()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.matches || [];
        setMatches(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load your matches.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Both of these are optional enrichments: they resolve mentor names and
    // per-mentor average ratings. If either endpoint is missing, the
    // dashboard just shows ids and "—" instead of breaking.
    listMentors()
      .then((data) => {
        if (cancelled) return;
        const names = {};
        for (const mentor of data?.mentors || []) {
          if (mentor?.mentor_id) names[mentor.mentor_id] = mentor.name;
        }
        setMentorNames(names);
      })
      .catch(() => {});

    getFeedbackSummary()
      .then((data) => {
        if (cancelled) return;
        const ratings = {};
        const names = {};
        for (const row of data?.mentors || []) {
          if (!row?.mentor_id) continue;
          if (typeof row.average_rating === "number") {
            ratings[row.mentor_id] = row.average_rating;
          }
          if (row.name) names[row.mentor_id] = row.name;
        }
        setMentorRatings(ratings);
        // Only fills gaps — /mentors is the better name source when present.
        setMentorNames((prev) => ({ ...names, ...prev }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleSubmitted = useCallback((match, submitted) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.match_id === match.match_id
          ? { ...m, status: "completed", feedback: submitted }
          : m
      )
    );
  }, []);

  function openLogDialog(match) {
    setActiveMatch(match);
    setDialogOpen(true);
  }

  const stats = useMemo(() => {
    const total = matches.length;
    const emailsSent = matches.filter((m) => EMAILED_STATUSES.has(statusOf(m))).length;
    const completed = matches.filter((m) => statusOf(m) === "completed").length;

    const known = matches.map(feedbackOf);
    const attendedKnown = known.filter((f) => f.attended !== null);
    const attendedCount =
      attendedKnown.filter((f) => f.attended).length +
      matches.filter((m) => statusOf(m) === "accepted").length;

    const ratings = known
      .map((f) => f.rating)
      .filter((r) => typeof r === "number" && r > 0);

    // Fall back to the per-mentor averages for mentors this user completed a
    // match with — the match records themselves don't carry the rating.
    const fallbackRatings = ratings.length
      ? []
      : matches
          .filter((m) => statusOf(m) === "completed")
          .map((m) => mentorRatings[m.mentor_id])
          .filter((r) => typeof r === "number" && r > 0);

    const usedRatings = ratings.length ? ratings : fallbackRatings;
    const avg = usedRatings.length
      ? (usedRatings.reduce((a, b) => a + b, 0) / usedRatings.length).toFixed(1)
      : null;

    const attendanceKnown = attendedKnown.length > 0 || completed === 0;

    return [
      {
        label: "Total matches",
        value: total,
        hint: total === 0 ? "Run a match to get started" : undefined,
      },
      {
        label: "Emails drafted",
        value: emailsSent,
        hint: "Intro drafts handed off to you",
      },
      {
        label: "Meetings attended",
        value: attendanceKnown ? attendedCount : "—",
        hint: attendanceKnown ? undefined : "Not reported on these records",
      },
      {
        label: "Avg satisfaction",
        value: avg ?? "—",
        hint: avg ? "Out of 5" : "No feedback logged yet",
      },
    ];
  }, [matches, mentorRatings]);

  const showEmptyState = !loading && !error && matches.length === 0;

  return (
    <>
      <PageShell width="full">
        <PageHeader
          title="Dashboard"
          description="Every mentor match you've made, and how each one turned out."
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Refresh
              </Button>
              <Button size="sm" render={<Link href="/matches" />}>
                View matches
              </Button>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} loading={loading} />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Match history</CardTitle>
            <CardDescription>
              Status moves from pending → emailed → completed as you draft the
              intro and log the outcome.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : error ? (
              <InlineError message={error}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  Try again
                </Button>
              </InlineError>
            ) : showEmptyState ? (
              <StateCard
                icon={LayoutDashboard}
                title="No matches recorded yet"
                description="Upload a pitch deck and run the matching — every match shows up here so you can track the outcome."
                actions={<Button render={<Link href="/upload" />}>Upload a pitch deck</Button>}
                className="border-0 shadow-none bg-transparent"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mentor</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matches.map((match, i) => {
                    const status = statusOf(match);
                    const { rating } = feedbackOf(match);
                    const name =
                      match.mentor_name || mentorNames[match.mentor_id] || null;
                    const done = status === "completed";

                    return (
                      <TableRow key={match.match_id || `${match.mentor_id}-${i}`}>
                        <TableCell className="max-w-[16rem]">
                          {name ? (
                            <span className="truncate block">{name}</span>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground truncate block">
                              {match.mentor_id || "unknown"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {scoreLabel(match.score ?? match.match_score)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[status] || "secondary"}>
                            {STATUS_LABEL[status] || status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {typeof rating === "number" ? `${rating}/5` : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {timestampLabel(match.timestamp || match.updated_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {done ? (
                            <span className="text-xs text-muted-foreground">Logged</span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openLogDialog(match)}
                            >
                              Log outcome
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageShell>

      <LogOutcomeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        match={activeMatch}
        mentorName={
          activeMatch
            ? activeMatch.mentor_name || mentorNames[activeMatch.mentor_id]
            : null
        }
        onSubmitted={handleSubmitted}
      />
    </>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardPageContent />
    </AuthGuard>
  );
}
