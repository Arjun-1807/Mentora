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
  Mail,
  MapPin,
  RefreshCw,
  Sparkles,
  Star,
  TrendingUp,
  UserCircle,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import StatCard from "@/components/ui/StatCard";
import ScoreRing from "@/components/ui/ScoreRing";
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
import { EASE_OUT, SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";
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
          className={cn(
            "size-3.5",
            i < rating ? "fill-warning text-warning" : "text-muted-foreground/40"
          )}
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
        <Skeleton key={i} className={cn(className, "w-full rounded-2xl")} />
      ))}
    </div>
  );
}

/** Icon chip + title used in the heading of every dashboard card. */
function CardIconTitle({ icon: Icon, tone = "primary", children }) {
  const tones = {
    primary: "bg-primary/12 text-primary",
    spark: "bg-spark/14 text-spark",
    info: "bg-info/12 text-info",
    success: "bg-success/12 text-success",
  };
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn("flex size-8 items-center justify-center rounded-lg", tones[tone])}
      >
        <Icon className="size-4" />
      </span>
      {children}
    </CardTitle>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------- profile tab */

function ProfileField({ label, children, className }) {
  return (
    <div className={className}>
      <dt className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
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
    <Card className="gap-0 pt-0">
      {/* Cover band: gradient + grid, with the avatar overlapping its edge. */}
      <div
        aria-hidden="true"
        className="relative h-24 overflow-hidden bg-[linear-gradient(120deg,color-mix(in_oklch,var(--primary)_35%,var(--card)),color-mix(in_oklch,var(--spark)_22%,var(--card)))] sm:h-28"
      >
        <div className="absolute inset-0 bg-grid opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>
      <div className="flex flex-col gap-4 px-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="-mt-9 flex min-w-0 items-end gap-4">
          <span
            aria-hidden="true"
            className="flex size-[4.5rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-xl font-semibold text-primary-foreground shadow-lift ring-4 ring-card"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0 pb-1">
            <CardTitle className="truncate text-lg">{name}</CardTitle>
            {user?.email && (
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{user.email}</span>
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="self-start sm:self-auto"
          render={<Link href="/onboarding/mentor" />}
        >
          <UserCircle aria-hidden="true" />
          Edit profile
        </Button>
      </div>
      <CardContent className="pb-6 pt-6 sm:px-6">
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {profile.bio && (
            <ProfileField label="Bio" className="sm:col-span-2">
              <span className="leading-relaxed text-muted-foreground">{profile.bio}</span>
            </ProfileField>
          )}
          {sectors.length > 0 && (
            <ProfileField label="Expertise" className="sm:col-span-2">
              <span className="flex flex-wrap gap-1.5">
                {sectors.map((s) => (
                  <Badge key={s} variant="soft">
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
          {profile.geography && (
            <ProfileField label="Geography">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {profile.geography}
              </span>
            </ProfileField>
          )}
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
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Your profile is mostly empty. Complete it so Mentora can match you with the right
              startups.
            </p>
            <Button size="sm" className="shrink-0" render={<Link href="/onboarding/mentor" />}>
              Complete profile
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileTab({ user, userStatus, onRetry }) {
  if (!user) {
    // /me failed: without this the tab would show a skeleton forever.
    if (userStatus === "error") {
      return (
        <StateCard
          icon={UserCircle}
          tone="error"
          title="Couldn't load your profile"
          description="We couldn't reach your account details. Check your connection and try again."
          actions={
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          }
        />
      );
    }
    return <ListSkeleton rows={2} className="h-40" />;
  }
  return (
    <div className="space-y-6">
      <ProfileSummaryCard user={user} />
      <Card>
        <CardHeader>
          <CardIconTitle icon={CalendarDays} tone="info">
            Google Calendar
          </CardIconTitle>
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

/** Up to three waiting requests, shown as a compact preview on the overview. */
function RequestPreview({ requests }) {
  if (requests.length === 0) return null;
  return (
    <ul className="space-y-2">
      {requests.slice(0, 3).map((match, i) => {
        const profile = match.startup_profile || {};
        const label = profile.domain || match.startup_email || "Startup";
        const score = match.score ?? match.match_score;
        const pct = typeof score === "number" ? (score <= 1 ? score * 100 : score) : null;
        return (
          <motion.li
            key={matchKey(match) || i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.1 + i * 0.06 }}
            className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-xs font-semibold text-primary"
            >
              {initialsOf(label)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{label}</span>
              {profile.stage && (
                <span className="block truncate text-xs capitalize text-muted-foreground">
                  {profile.stage}
                </span>
              )}
            </span>
            {pct !== null && (
              <ScoreRing value={pct} size={34} stroke={3} label={`Match score ${Math.round(pct)}%`}>
                <span className="text-[9px]">{Math.round(pct)}</span>
              </ScoreRing>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

/** Exit animation for a request card: accepted slides right, declined left. */
const requestItemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, x: 0, scale: 1 },
  exit: (decision) => ({
    opacity: 0,
    x: decision === "declined" ? -80 : 80,
    scale: 0.96,
    transition: { duration: 0.32, ease: EASE_OUT },
  }),
};

/* ------------------------------------------------------------------- page */

function MentorDashboard() {
  const [tab, setTab] = useTabParam(TAB_IDS);
  const { user, userStatus, refresh: refreshUser } = useAuth();

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
  // Direction for the request card's exit animation (presentation only).
  const [lastDecision, setLastDecision] = useState(null);

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
  const firstName = String(user?.profile?.name || "").trim().split(/\s+/)[0] || "";
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

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="min-w-0"
          >
            <p className="eyebrow mb-2.5">
              {tab === "overview" ? `${greeting()}${firstName ? `, ${firstName}` : ""}` : "Mentor dashboard"}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {tab === "overview" ? (
                <>
                  Your mentoring,{" "}
                  <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
                    at a glance
                  </span>
                </>
              ) : (
                copy.title
              )}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
              {copy.description}
            </p>
          </motion.div>
        </AnimatePresence>
        {tab !== "profile" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={refreshing}
            className="shrink-0 self-start sm:self-auto"
          >
            {refreshing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Refresh
          </Button>
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
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={<Inbox />}
                  tone="spark"
                  label="Pending Requests"
                  value={stats?.pending_requests ?? 0}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<CalendarCheck />}
                  tone="success"
                  label="Accepted"
                  value={stats?.accepted ?? 0}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<Star />}
                  tone="warning"
                  label="Avg Rating"
                  value={avg ?? "—"}
                  trend={avg !== null ? "Out of 5" : "No ratings yet"}
                  loading={statsLoading && !stats}
                />
                <StatCard
                  icon={<TrendingUp />}
                  tone="primary"
                  label="Total Helped"
                  value={stats?.total_helped ?? 0}
                  trend="Startups you've met"
                  loading={statsLoading && !stats}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="relative lg:col-span-3">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-spark/10 blur-3xl"
                  />
                  <CardHeader>
                    <CardIconTitle icon={Inbox} tone="spark">
                      Requests waiting
                    </CardIconTitle>
                    <CardDescription>
                      {requestsLoading
                        ? "Checking for new requests…"
                        : requests.length === 0
                          ? "You're all caught up."
                          : `${requests.length} startup${requests.length === 1 ? " is" : "s are"} waiting for your answer.`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {requestsLoading ? (
                      <ListSkeleton rows={2} className="h-12" />
                    ) : requests.length === 0 ? (
                      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        New matches land here as soon as a startup&apos;s deck fits your expertise.
                      </div>
                    ) : (
                      <RequestPreview requests={requests} />
                    )}
                    <Button type="button" size="sm" variant="soft" onClick={() => setTab("requests")}>
                      Review requests
                      <ArrowRight
                        className="transition-transform group-hover/button:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Button>
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardIconTitle icon={CalendarDays} tone="info">
                      Google Calendar
                    </CardIconTitle>
                    <CardDescription>Needed for startups to book time with you.</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-4">
                    <CalendarStatus initial={user?.calendar_connected} size="sm" />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="self-start"
                      onClick={() => setTab("profile")}
                    >
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
              <ul className="relative space-y-3">
                <AnimatePresence mode="popLayout" initial={false} custom={lastDecision}>
                  {requests.map((match, i) => {
                    const profile = match.startup_profile || {};
                    const key = matchKey(match);
                    return (
                      <motion.li
                        key={key || i}
                        layout
                        custom={lastDecision}
                        variants={requestItemVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={{ layout: SPRING.soft }}
                      >
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
                          onAccept={() => {
                            setLastDecision("accepted");
                            respond(match, "accepted");
                          }}
                          onDecline={() => {
                            setLastDecision("declined");
                            respond(match, "declined");
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                            {match.startup_email && (
                              <span className="inline-flex items-center gap-1.5 break-all">
                                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                                {match.startup_email}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                              Matched {dateLabel(match.timestamp || match.updated_at)}
                            </span>
                            {Array.isArray(profile.team_gaps) && profile.team_gaps.length > 0 && (
                              <span className="inline-flex items-center gap-1.5">
                                <Users className="size-3.5 shrink-0" aria-hidden="true" />
                                Team gaps: {profile.team_gaps.slice(0, 3).join(", ")}
                              </span>
                            )}
                          </div>
                        </MentorCard>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            ))}

          {tab === "past" &&
            (allLoading ? (
              <ListSkeleton rows={4} className="h-14" />
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
              />
            ) : (
              <>
                {/* Phones: stacked cards. */}
                <ul className="space-y-3 sm:hidden">
                  {pastMeetings.map((match, i) => (
                    <motion.li
                      key={matchKey(match) || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: EASE_OUT, delay: Math.min(i, 8) * 0.04 }}
                      className="surface rounded-2xl p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {match.startup_profile?.domain || "Unknown"}
                          </p>
                          {match.startup_email && (
                            <p className="truncate text-xs text-muted-foreground">{match.startup_email}</p>
                          )}
                        </div>
                        <StatusBadge status={statusOf(match)} />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                        <span>
                          {match.meeting?.date
                            ? `${dateLabel(match.meeting.date)}${match.meeting.start_time ? ` · ${match.meeting.start_time}` : ""}`
                            : dateLabel(match.updated_at || match.timestamp)}
                        </span>
                        <StarDisplay rating={ratingOf(match)} />
                      </div>
                    </motion.li>
                  ))}
                </ul>

                {/* sm and up: table. */}
                <Card className="hidden py-2 sm:flex">
                  <CardContent className="px-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-4">Startup Domain</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="pr-4">Rating</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pastMeetings.map((match, i) => {
                          const domain = match.startup_profile?.domain || "Unknown";
                          return (
                            <motion.tr
                              key={matchKey(match) || i}
                              data-slot="table-row"
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.35, ease: EASE_OUT, delay: Math.min(i, 10) * 0.03 }}
                              className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                            >
                              <TableCell className="max-w-[16rem] py-3 pl-4">
                                <span className="flex items-center gap-3">
                                  <span
                                    aria-hidden="true"
                                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-[11px] font-semibold text-primary"
                                  >
                                    {initialsOf(domain)}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium text-foreground">{domain}</span>
                                    {match.startup_email && (
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {match.startup_email}
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {match.meeting?.date
                                  ? `${dateLabel(match.meeting.date)}${match.meeting.start_time ? ` · ${match.meeting.start_time}` : ""}`
                                  : dateLabel(match.updated_at || match.timestamp)}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={statusOf(match)} />
                              </TableCell>
                              <TableCell className="pr-4">
                                <StarDisplay rating={ratingOf(match)} />
                              </TableCell>
                            </motion.tr>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            ))}

          {tab === "profile" && (
            <ProfileTab user={user} userStatus={userStatus} onRetry={refreshUser} />
          )}
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
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
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
