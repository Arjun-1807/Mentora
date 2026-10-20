"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  History,
  Inbox,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Star,
  TrendingUp,
  UserCircle,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import MentorCard from "@/components/ui/MentorCard";
import { StateCard, InlineError } from "@/components/StateCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DashboardShell, { useTabParam } from "@/components/dashboard/DashboardShell";
import HealthLogDialog from "@/components/dashboard/HealthLogDialog";
import PostMeetingBanner from "@/components/dashboard/PostMeetingBanner";
import AvailabilityGrid from "@/components/dashboard/AvailabilityGrid";
import { CalendarStatus } from "@/components/dashboard/CalendarConnect";
import {
  dateLabel,
  initialsOf,
  sameMatch,
  statusOf,
  withHealthLogged,
} from "@/components/dashboard/helpers";
import { useAuth } from "@/hooks/use-auth";
import { isHttpUrl } from "@/lib/validation";
import { getMentorMatches, getMentorStats, updateMentorMatchStatus } from "@/lib/api";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "past", label: "Past Meetings", icon: History },
  { id: "profile", label: "Profile", icon: UserCircle },
];
const TAB_IDS = TABS.map((t) => t.id);

const TAB_COPY = {
  overview: { title: "Overview", description: "Your mentoring activity at a glance." },
  requests: {
    title: "Requests",
    description: "Startups Mentora matched with your profile. Accept to let them book time with you.",
  },
  past: { title: "Past Meetings", description: "Startups you've accepted and met with." },
  profile: {
    title: "Profile",
    description: "What startups see, your calendar connection and your weekly availability.",
  },
};

/** Must match GET /mentor/stats `pending_requests` (see CONTRACT). */
const REQUEST_STATUSES = "pending,emailed,email_sent";
const REQUEST_SET = new Set(REQUEST_STATUSES.split(","));
const PAST_SET = new Set(["accepted", "meeting_scheduled", "completed"]);

function matchKey(match) {
  return match?._id || match?.match_id;
}

function startupName(match) {
  return match?.startup_profile?.domain || match?.startup_email || "this startup";
}

function ratingOf(match) {
  const r = [match?.rating, match?.feedback?.rating, match?.effectiveness_score].find(
    (v) => typeof v === "number" && v > 0
  );
  return typeof r === "number" ? Math.round(r) : null;
}

/** Client-side stand-in for GET /mentor/stats if that endpoint fails. */
function fallbackStats(matches) {
  const ratings = matches.map(ratingOf).filter((r) => r !== null);
  const helped = new Set(
    matches
      .filter((m) => ["meeting_scheduled", "completed"].includes(statusOf(m)))
      .map((m) => m.user_id || m.startup_email || matchKey(m))
  );
  return {
    pending_requests: matches.filter((m) => REQUEST_SET.has(statusOf(m))).length,
    accepted: matches.filter((m) => PAST_SET.has(statusOf(m))).length,
    avg_rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    total_helped: helped.size,
  };
}

function StarDisplay({ rating }) {
  if (!rating) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < rating ? "fill-primary text-primary" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function ListSkeleton({ rows = 3, className = "h-24" }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`${className} w-full`} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- profile tab */

function ProfileField({ label, children }) {
  return (
    <div>
      <dt className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ProfileSummaryCard({ user }) {
  const profile = user?.profile || {};
  const name = profile.name || user?.email || "Mentor";
  const sectors = Array.isArray(profile.sector_expertise) ? profile.sector_expertise : [];
  const rawStages = profile.preferred_stages ?? profile.stage_focus ?? profile.stageFocus;
  const stages = Array.isArray(rawStages) ? rawStages : rawStages ? [rawStages] : [];
  const linkedin = isHttpUrl(profile.linkedin_url) ? profile.linkedin_url : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{name}</CardTitle>
            {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          </div>
        </div>
        <Button size="sm" variant="outline" render={<Link href="/onboarding/mentor" />}>
          <UserCircle aria-hidden="true" />
          Edit Profile
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {profile.bio && (
            <div className="sm:col-span-2">
              <dt className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Bio</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{profile.bio}</dd>
            </div>
          )}
          {sectors.length > 0 && (
            <ProfileField label="Expertise">
              <span className="flex flex-wrap gap-1.5">
                {sectors.map((s) => (
                  <Badge key={s} variant="outline">
                    {s === "Others" ? "Other" : s}
                  </Badge>
                ))}
              </span>
            </ProfileField>
          )}
          {stages.length > 0 && (
            <ProfileField label="Stage focus">
              <span className="capitalize">
                {stages.map((s) => (s === "all" ? "All stages" : s)).join(", ")}
              </span>
            </ProfileField>
          )}
          {profile.geography && <ProfileField label="Geography">{profile.geography}</ProfileField>}
          {profile.availability && <ProfileField label="Availability">{profile.availability}</ProfileField>}
          {(profile.years_experience || profile.experience) && (
            <ProfileField label="Experience">{profile.years_experience || profile.experience} years</ProfileField>
          )}
          {profile.max_startups_per_month && (
            <ProfileField label="Startups per month">{profile.max_startups_per_month}</ProfileField>
          )}
          {profile.past_exits && <ProfileField label="Past exits">{profile.past_exits}</ProfileField>}
          {linkedin && (
            <ProfileField label="LinkedIn">
              <a
                href={linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline-offset-4 hover:underline"
              >
                {linkedin}
              </a>
            </ProfileField>
          )}
        </dl>
        {sectors.length === 0 && !profile.bio && (
          <p className="text-sm text-muted-foreground">
            Your profile is mostly empty. Complete it so Mentora can match you with the right startups.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileTab({ user }) {
  if (!user) return <ListSkeleton rows={2} className="h-40" />;
  return (
    <div className="space-y-6">
      <ProfileSummaryCard user={user} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
            Google Calendar
          </CardTitle>
          <CardDescription>
            Startups can only book a meeting with you once your calendar is connected. Events are
            created with a Google Meet link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarStatus initial={user.calendar_connected} />
        </CardContent>
      </Card>
      <AvailabilityGrid mentorId={user.mentor_id} />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

function MentorDashboard() {
  const [tab, setTab] = useTabParam(TAB_IDS);
  const { user } = useAuth();

  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const [allMatches, setAllMatches] = useState([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState("");
  const [apiStats, setApiStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const [healthMatch, setHealthMatch] = useState(null);
  const [healthOpen, setHealthOpen] = useState(false);

  const loadStats = useCallback(() => {
    let cancelled = false;
    setStatsLoading(true);
    getMentorStats()
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
    const toList = (data) => (Array.isArray(data) ? data : data?.matches || []);

    setRequestsLoading(true);
    setRequestsError("");
    getMentorMatches({ status: REQUEST_STATUSES })
      .then((data) => {
        if (!cancelled) setRequests(toList(data));
      })
      .catch((err) => {
        if (!cancelled) setRequestsError(err.message || "Could not load your match requests.");
      })
      .finally(() => {
        if (!cancelled) setRequestsLoading(false);
      });

    setAllLoading(true);
    setAllError("");
    getMentorMatches()
      .then((data) => {
        if (!cancelled) setAllMatches(toList(data));
      })
      .catch((err) => {
        if (!cancelled) setAllError(err.message || "Could not load your meetings.");
      })
      .finally(() => {
        if (!cancelled) setAllLoading(false);
      });

    const cancelStats = loadStats();
    return () => {
      cancelled = true;
      cancelStats();
    };
  }, [reloadKey, loadStats]);

  const stats = useMemo(
    () => (statsFailed ? fallbackStats(allMatches) : apiStats),
    [statsFailed, apiStats, allMatches]
  );

  const pastMeetings = useMemo(
    () =>
      allMatches
        .filter((m) => PAST_SET.has(statusOf(m)))
        .sort((a, b) => {
          const t = (m) => new Date(m.meeting?.date || m.updated_at || m.timestamp || 0).getTime() || 0;
          return t(b) - t(a);
        }),
    [allMatches]
  );

  /** Accept/decline with optimistic removal; restores the card on failure. */
  const respond = useCallback(
    async (match, decision) => {
      const key = matchKey(match);
      if (!key || busy[key]) return;
      const index = requests.findIndex((m) => matchKey(m) === key);

      setBusy((b) => ({ ...b, [key]: decision === "accepted" ? "accept" : "decline" }));
      setRequests((prev) => prev.filter((m) => matchKey(m) !== key));
      try {
        // PATCH /mentor/matches/{id} takes the Mongo `_id` of the match doc.
        await updateMentorMatchStatus(key, decision);
        toast.success(
          decision === "accepted"
            ? `Accepted ${startupName(match)}. They can now book a meeting with you.`
            : `Declined ${startupName(match)}.`
        );
        setAllMatches((prev) => prev.map((m) => (matchKey(m) === key ? { ...m, status: decision } : m)));
        loadStats();
      } catch (err) {
        setRequests((prev) => {
          if (prev.some((m) => matchKey(m) === key)) return prev;
          const next = [...prev];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, match);
          return next;
        });
        if (err?.status !== 0) toast.error(err.message || "Could not update this request.");
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[key];
          return next;
        });
      }
    },
    [busy, requests, loadStats]
  );

  const handleHealthLogged = useCallback(
    (match) => {
      setAllMatches((prev) => prev.map((m) => (sameMatch(m, match) ? withHealthLogged(m, "mentor") : m)));
      loadStats();
    },
    [loadStats]
  );

  const avg = typeof stats?.avg_rating === "number" ? Math.round(stats.avg_rating * 10) / 10 : null;
  const pendingCount = requestsLoading ? stats?.pending_requests : requests.length;
  const navItems = TABS.map((t) => (t.id === "requests" ? { ...t, badge: pendingCount } : t));
  const copy = TAB_COPY[tab];
  const refreshing = requestsLoading || allLoading || statsLoading;

  return (
    <DashboardShell items={navItems} active={tab} onSelect={setTab} title="Mentor dashboard">
      <PostMeetingBanner
        matches={allMatches}
        role="mentor"
        nameOf={startupName}
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
        {tab !== "profile" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
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
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={<Inbox />}
                  label="Pending Requests"
                  value={stats?.pending_requests ?? 0}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<CalendarCheck />}
                  label="Accepted"
                  value={stats?.accepted ?? 0}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<Star />}
                  label="Avg Rating"
                  value={avg ?? "—"}
                  trend={avg !== null ? "Out of 5" : "No ratings yet"}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<TrendingUp />}
                  label="Total Helped"
                  value={stats?.total_helped ?? 0}
                  trend="Startups you've met"
                  loading={statsLoading && !stats}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Inbox className="h-4 w-4 text-primary" aria-hidden="true" />
                      Requests waiting
                    </CardTitle>
                    <CardDescription>
                      {requestsLoading
                        ? "Checking for new requests…"
                        : requests.length === 0
                          ? "You're all caught up."
                          : `${requests.length} startup${requests.length === 1 ? " is" : "s are"} waiting for your answer.`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button type="button" size="sm" variant="outline" onClick={() => setTab("requests")}>
                      Review requests
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                      Google Calendar
                    </CardTitle>
                    <CardDescription>Needed for startups to book time with you.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-3">
                    <CalendarStatus initial={user?.calendar_connected} size="sm" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setTab("profile")}>
                      Set availability
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {tab === "requests" &&
            (requestsLoading ? (
              <ListSkeleton />
            ) : requestsError ? (
              <InlineError message={requestsError}>
                <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                  Try again
                </Button>
              </InlineError>
            ) : requests.length === 0 ? (
              <StateCard
                icon={Users}
                title="No pending requests"
                description="When startups match with your profile, their requests appear here."
              />
            ) : (
              <ul className="space-y-3">
                {requests.map((match, i) => {
                  const profile = match.startup_profile || {};
                  const key = matchKey(match);
                  return (
                    <li key={key || i}>
                      <MentorCard
                        variant="request"
                        index={i}
                        mentor={{
                          name: profile.domain || match.startup_email || "Startup",
                          domain: profile.domain,
                          stage_focus: profile.stage,
                          expertise: Array.isArray(profile.challenges) ? profile.challenges : [],
                          email: match.startup_email,
                        }}
                        matchScore={match.score ?? match.match_score}
                        busy={busy[key] || false}
                        onAccept={() => respond(match, "accepted")}
                        onDecline={() => respond(match, "declined")}
                      >
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {match.startup_email && <span className="break-all">{match.startup_email}</span>}
                          <span>Matched {dateLabel(match.timestamp || match.updated_at)}</span>
                          {Array.isArray(profile.team_gaps) && profile.team_gaps.length > 0 && (
                            <span>Team gaps: {profile.team_gaps.slice(0, 3).join(", ")}</span>
                          )}
                        </div>
                      </MentorCard>
                    </li>
                  );
                })}
              </ul>
            ))}

          {tab === "past" && (
            <Card>
              <CardContent>
                {allLoading ? (
                  <ListSkeleton rows={4} className="h-10" />
                ) : allError ? (
                  <InlineError message={allError}>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                      Try again
                    </Button>
                  </InlineError>
                ) : pastMeetings.length === 0 ? (
                  <StateCard
                    icon={CheckCircle2}
                    title="No meetings yet"
                    description="Startups you accept will appear here, along with their meeting and rating."
                    className="border-0 bg-transparent shadow-none ring-0"
                  />
                ) : (
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
                      {pastMeetings.map((match, i) => (
                        <TableRow key={matchKey(match) || i}>
                          <TableCell className="max-w-[14rem]">
                            <span className="block truncate font-medium">
                              {match.startup_profile?.domain || "Unknown"}
                            </span>
                            {match.startup_email && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {match.startup_email}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {match.meeting?.date
                              ? `${dateLabel(match.meeting.date)}${match.meeting.start_time ? ` · ${match.meeting.start_time}` : ""}`
                              : dateLabel(match.updated_at || match.timestamp)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={statusOf(match)} />
                          </TableCell>
                          <TableCell>
                            <StarDisplay rating={ratingOf(match)} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "profile" && <ProfileTab user={user} />}
        </motion.div>
      </AnimatePresence>

      <HealthLogDialog
        open={healthOpen}
        onOpenChange={setHealthOpen}
        match={healthMatch}
        role="mentor"
        counterpartName={healthMatch ? startupName(healthMatch) : null}
        onLogged={handleHealthLogged}
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

export default function MentorDashboardPage() {
  return (
    <AuthGuard requiredRole="mentor">
      {/* useSearchParams (tab sync) needs a Suspense boundary for `next build`. */}
      <Suspense fallback={<ShellFallback />}>
        <MentorDashboard />
      </Suspense>
    </AuthGuard>
  );
}
