"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { StateCard, InlineError } from "@/components/StateCard";
import { CountUp, HoverCard } from "@/components/motion";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Loader2, Users, CalendarCheck, Star, TrendingUp, Inbox, UserCircle } from "lucide-react";
import { getMentorMatches, updateMentorMatchStatus } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

// ── helpers ─────────────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  pending: "secondary",
  accepted: "default",
  declined: "destructive",
  emailed: "outline",
  email_sent: "outline",
  completed: "default",
};

const STATUS_LABEL = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  emailed: "Drafted",
  email_sent: "Intro sent",
  completed: "Completed",
};

function scorePercent(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)));
}

function timestampLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

// Star display (read-only)
function StarDisplay({ rating }) {
  if (!rating) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, hint, loading }) {
  return (
    <HoverCard>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </CardTitle>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <>
              <p className="text-3xl font-bold text-foreground tabular-nums">
                {typeof value === "number" ? <CountUp value={value} decimals={value % 1 !== 0 ? 1 : 0} /> : value}
              </p>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </HoverCard>
  );
}

// ── Match Request Card ───────────────────────────────────────────────────────

function MatchRequestCard({ match, onAction }) {
  const [acting, setActing] = useState(null); // "accepted" | "declined" | null
  const profile = match.startup_profile || {};
  const challenges = Array.isArray(profile.challenges) ? profile.challenges.slice(0, 3) : [];
  const score = scorePercent(match.score ?? match.match_score);
  const status = (match.status || "pending").toLowerCase();
  const isDone = status === "accepted" || status === "declined";

  async function handleAction(newStatus) {
    if (acting || isDone) return;
    setActing(newStatus);
    try {
      await updateMentorMatchStatus(match._id || match.match_id, newStatus);
      toast.success(newStatus === "accepted" ? "Request accepted!" : "Request declined.");
      onAction(match._id || match.match_id, newStatus);
    } catch (err) {
      toast.error(err.message || "Could not update this request.");
    } finally {
      setActing(null);
    }
  }

  return (
    <HoverCard>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">
                {profile.domain || "Unknown domain"}
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {profile.stage && (
                  <Badge variant="secondary">{profile.stage} stage</Badge>
                )}
                <Badge variant={STATUS_VARIANT[status] || "secondary"}>
                  {STATUS_LABEL[status] || status}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {challenges.length > 0 && (
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
              {challenges.map((c, i) => (
                <li key={i} className="truncate">{c}</li>
              ))}
            </ul>
          )}

          {score !== null && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Match Score
                </span>
                <span className="text-sm font-semibold text-primary tabular-nums">
                  {score}%
                </span>
              </div>
              <Progress value={score} aria-label={`Match score ${score}%`} />
            </div>
          )}

          {!isDone && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => handleAction("accepted")}
                disabled={!!acting}
              >
                {acting === "accepted" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Accept
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => handleAction("declined")}
                disabled={!!acting}
              >
                {acting === "declined" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Decline
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </HoverCard>
  );
}

// ── Profile Summary Card ─────────────────────────────────────────────────────

function ProfileSummaryCard({ user }) {
  const profile = user?.profile || {};
  const name = profile.name || user?.email || "Mentor";
  const sectors = Array.isArray(profile.sector_expertise) ? profile.sector_expertise : [];
  const stage = profile.stage_focus || profile.stageFocus;
  const geography = profile.geography;
  const availability = profile.availability;

  return (
    <HoverCard>
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{name}</CardTitle>
              {user?.email && (
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sectors.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Expertise</p>
              <div className="flex flex-wrap gap-1.5">
                {sectors.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            </div>
          )}
          {stage && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Stage focus</p>
              <p className="text-sm">{stage === "all" ? "All stages" : `${stage} stage`}</p>
            </div>
          )}
          {geography && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Geography</p>
              <p className="text-sm">{geography}</p>
            </div>
          )}
          {availability && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Availability</p>
              <p className="text-sm">{availability}</p>
            </div>
          )}
          <div className="pt-2">
            <Button size="sm" variant="outline" className="w-full" render={<Link href="/onboarding/mentor" />}>
              <UserCircle className="h-4 w-4" aria-hidden="true" />
              Edit Profile
            </Button>
          </div>
        </CardContent>
      </Card>
    </HoverCard>
  );
}

// ── Main content ─────────────────────────────────────────────────────────────

function MentorDashboardContent() {
  const { user } = useAuth();
  const [allMatches, setAllMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    getMentorMatches()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.matches || [];
        setAllMatches(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load your match requests.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reloadKey]);

  // Update a match's status inline without page reload
  const handleMatchAction = useCallback((matchId, newStatus) => {
    setAllMatches((prev) =>
      prev.map((m) =>
        (m._id === matchId || m.match_id === matchId)
          ? { ...m, status: newStatus }
          : m
      )
    );
  }, []);

  // Derived stats
  const stats = useMemo(() => {
    const pending = allMatches.filter((m) => (m.status || "pending") === "pending").length;
    const accepted = allMatches.filter((m) => m.attended === true || m.status === "accepted").length;

    const ratings = allMatches
      .map((m) => m.effectiveness_score ?? m.rating)
      .filter((r) => typeof r === "number" && r > 0);
    const avgRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : null;

    const total = allMatches.length;

    return [
      { label: "Pending Requests", value: pending, icon: Inbox, hint: "Awaiting your response" },
      { label: "Meetings Accepted", value: accepted, icon: CalendarCheck, hint: "You accepted these" },
      {
        label: "Avg Rating",
        value: avgRating ?? "—",
        icon: Star,
        hint: avgRating !== null ? "Out of 5" : "No ratings yet",
      },
      { label: "Total Startups Helped", value: total, icon: TrendingUp, hint: "All-time matches" },
    ];
  }, [allMatches]);

  // Pending requests (those awaiting a response)
  const pendingRequests = allMatches.filter((m) => (m.status || "pending") === "pending");

  // Past meetings (accepted / beyond)
  const pastMeetings = allMatches.filter((m) =>
    ["accepted", "met", "rated", "completed", "email_sent"].includes(m.status)
  );

  return (
    <PageShell width="full">
      <PageHeader
        title="Mentor Dashboard"
        description="Review incoming startup requests and track your mentoring activity."
        actions={
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
        }
      />

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-8 min-w-0">
          {/* Incoming Match Requests */}
          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Incoming Match Requests
            </h2>

            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 w-full" />
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
            ) : pendingRequests.length === 0 ? (
              <StateCard
                icon={Users}
                title="No pending requests"
                description="When startups match with your profile, their requests appear here."
                className="border-0 shadow-none bg-transparent"
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {pendingRequests.map((match) => (
                  <MatchRequestCard
                    key={match._id || match.match_id}
                    match={match}
                    onAction={handleMatchAction}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Past Meetings */}
          <section>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Past Meetings
            </h2>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : pastMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Accepted matches will appear here once you&apos;ve had meetings.
              </p>
            ) : (
              <HoverCard>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Startup Domain</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Rating</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pastMeetings.map((match, i) => {
                          const profile = match.startup_profile || {};
                          const status = (match.status || "").toLowerCase();
                          const rating = match.rating ?? match.effectiveness_score ?? null;
                          return (
                            <TableRow key={match._id || match.match_id || i}>
                              <TableCell className="font-medium">
                                {profile.domain || <span className="text-muted-foreground text-xs">Unknown</span>}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {timestampLabel(match.timestamp || match.updated_at)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={STATUS_VARIANT[status] || "secondary"}>
                                  {STATUS_LABEL[status] || status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <StarDisplay rating={typeof rating === "number" ? Math.round(rating) : null} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </HoverCard>
            )}
          </section>
        </div>

        {/* Profile Summary Sidebar */}
        <aside>
          <ProfileSummaryCard user={user} />
        </aside>
      </div>
    </PageShell>
  );
}

export default function MentorDashboardPage() {
  return (
    <AuthGuard requiredRole="mentor">
      <MentorDashboardContent />
    </AuthGuard>
  );
}
