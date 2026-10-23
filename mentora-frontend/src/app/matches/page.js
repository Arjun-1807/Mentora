"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Crown,
  Gauge,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Trophy,
  UserSearch,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { PageHeader, PageShell } from "@/components/PageShell";
import { CountUp, FadeIn, SPRING } from "@/components/motion";
import MentorCard from "@/components/ui/MentorCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { StateCard, InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import EmailDialog from "@/components/matches/EmailDialog";
import BookingSection from "@/components/matches/BookingSection";
import MeetingCard from "@/components/matches/MeetingCard";
import {
  mergeLiveStatuses,
  scorePercent,
  toStartupProfilePayload,
} from "@/components/matches/matchData";
import { getAllMatches, matchMentors } from "@/lib/api";
import { getStoredMatches, getStoredProfile, setStoredMatches } from "@/lib/storage";
import { cn } from "@/lib/utils";

const TOP_N = 5;

/** Lifecycle order, so a local update never moves a match backwards. */
const STATUS_ORDER = ["pending", "emailed", "email_sent", "accepted", "meeting_scheduled", "completed"];

function statusRank(status) {
  const i = STATUS_ORDER.indexOf(String(status || "pending").toLowerCase());
  return i === -1 ? 0 : i;
}

const STAGE_ORDER = { idea: 0, mvp: 1, growth: 2, all: 3 };

const SORTS = [
  { value: "score", label: "Score" },
  { value: "domain", label: "Domain" },
  { value: "stage", label: "Stage" },
];

function scoreOf(m) {
  return typeof m.match_score === "number" ? m.match_score : -1;
}

function sortMatches(list, sortBy) {
  const byScore = (a, b) => scoreOf(b) - scoreOf(a);
  const copy = [...list];
  if (sortBy === "domain") {
    copy.sort((a, b) => String(a.domain || "").localeCompare(String(b.domain || "")) || byScore(a, b));
  } else if (sortBy === "stage") {
    const rank = (m) => STAGE_ORDER[String(m.stage_focus || "").toLowerCase()] ?? 99;
    copy.sort((a, b) => rank(a) - rank(b) || byScore(a, b));
  } else {
    copy.sort(byScore);
  }
  return copy;
}

function sameMatch(a, b) {
  return (a.match_id && a.match_id === b.match_id) || (!a.match_id && a.mentor_id === b.mentor_id);
}

function MatchesPageContent() {
  const router = useRouter();
  const [matches, setMatches] = useState(null);
  const [startupProfile, setStartupProfile] = useState(null);
  const [activeMentor, setActiveMentor] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [query, setQuery] = useState("");

  /** Overlays live status/meeting from /matches/all onto `list` and persists it. */
  const syncLiveStatuses = useCallback(async (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    try {
      const live = await getAllMatches();
      setMatches((prev) => {
        const merged = mergeLiveStatuses(prev ?? list, live);
        setStoredMatches(merged);
        return merged;
      });
    } catch {
      // Live statuses are a nice-to-have; the cached list still works.
      // (Network failures already raised the "Server unavailable" toast.)
    }
  }, []);

  useEffect(() => {
    // `null` = matching never ran for this profile (vs. `[]` = ran, no hits).
    const stored = getStoredMatches();
    if (stored === null) {
      toast.info("Please complete your profile first", { id: "matches-missing" });
      router.replace("/profile");
      return;
    }
    setMatches(stored);
    setStartupProfile(getStoredProfile());
    syncLiveStatuses(stored);
  }, [router, syncLiveStatuses]);

  const runMatch = useCallback(
    async (profile) => {
      if (!profile || rematching) return;
      setRematching(true);
      setError("");
      try {
        // /match takes a StartupProfile only — never send deck_feedback.
        const data = await matchMentors(toStartupProfilePayload(profile));
        const list = Array.isArray(data) ? data : data?.matches || [];
        setStoredMatches(list);
        setMatches(list);
        syncLiveStatuses(list);
      } catch (err) {
        setError(err.message || "Could not refresh your mentor matches.");
      } finally {
        setRematching(false);
      }
    },
    [rematching, syncLiveStatuses]
  );

  function openEmailDialog(mentor) {
    setActiveMentor(mentor);
    setDialogOpen(true);
  }

  const updateMatch = useCallback((target, patch) => {
    setMatches((prev) => {
      if (!prev) return prev;
      const next = prev.map((m) => (sameMatch(m, target) ? { ...m, ...patch(m) } : m));
      // Persist so the status survives a reload.
      setStoredMatches(next);
      return next;
    });
  }, []);

  const markSent = useCallback(
    (mentor) =>
      updateMatch(mentor, (m) =>
        statusRank(m.status) < statusRank("email_sent") ? { status: "email_sent" } : {}
      ),
    [updateMatch]
  );

  const markBooked = useCallback(
    (match, meeting) => updateMatch(match, () => ({ status: "meeting_scheduled", meeting })),
    [updateMatch]
  );

  const visible = useMemo(() => {
    if (!Array.isArray(matches)) return [];
    const top = matches.slice(0, TOP_N).map((m, i) => ({ ...m, _rank: i + 1 }));
    const q = query.trim().toLowerCase();
    const filtered = q
      ? top.filter(
          (m) =>
            String(m.name || "").toLowerCase().includes(q) ||
            String(m.domain || "").toLowerCase().includes(q)
        )
      : top;
    return sortMatches(filtered, sortBy);
  }, [matches, query, sortBy]);

  if (matches === null) {
    return (
      <PageShell key="loading" width="wide">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="mb-3 h-10 w-80 max-w-full" />
        <Skeleton className="mb-10 h-5 w-full max-w-md" />
        <div className="mb-8 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (matches.length === 0) {
    return (
      <PageShell key="empty" width="lg" center>
        <div className="space-y-4">
          {error && (
            <InlineError message={error}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => runMatch(startupProfile)}
                disabled={rematching}
              >
                Try again
              </Button>
            </InlineError>
          )}
          <StateCard
            icon={UserSearch}
            title="No matches found"
            description="Try re-uploading a more detailed deck."
            actions={
              <>
                <Button render={<Link href="/upload" />}>Re-upload deck</Button>
                {startupProfile && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runMatch(startupProfile)}
                    disabled={rematching}
                  >
                    {rematching && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {rematching ? "Searching…" : "Search again"}
                  </Button>
                )}
              </>
            }
          />
        </div>
      </PageShell>
    );
  }

  const topFive = matches.slice(0, TOP_N);
  const scores = topFive.map((m) => scorePercent(m.match_score)).filter((n) => n !== null);
  const bestScore = scores.length ? Math.max(...scores) : null;
  const avgScore = scores.length
    ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length)
    : null;
  const introsSent = topFive.filter((m) => statusRank(m.status) >= statusRank("email_sent")).length;
  const summary = [
    { label: "Best fit", value: bestScore, suffix: "%", icon: Trophy, tone: "text-spark bg-spark/14" },
    { label: "Average fit", value: avgScore, suffix: "%", icon: Gauge, tone: "text-primary bg-primary/12" },
    { label: "Intros sent", value: introsSent, suffix: "", icon: Send, tone: "text-success bg-success/12" },
  ];

  return (
    <>
      <PageShell width="wide">
        <PageHeader
          eyebrow="Step 3 of 3 · Connect"
          title={
            <>
              Your top mentor{" "}
              <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
                matches
              </span>
            </>
          }
          description="Ranked by domain fit, stage alignment, and mentor track record."
          actions={
            <>
              <Button variant="ghost" render={<Link href="/dashboard" />}>
                <LayoutDashboard aria-hidden="true" />
                <span className="hidden sm:inline">View dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => runMatch(startupProfile)}
                disabled={rematching || !startupProfile}
              >
                {rematching ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                {rematching ? "Refreshing…" : "Refresh matches"}
              </Button>
            </>
          }
        />

        {error && (
          <InlineError message={error} className="mb-6">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runMatch(startupProfile)}
              disabled={rematching}
            >
              Try again
            </Button>
          </InlineError>
        )}

        {/* Summary strip */}
        <FadeIn className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">
          {summary.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="surface flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4"
              >
                <span
                  aria-hidden="true"
                  className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-10", item.tone)}
                >
                  <Icon className="size-4 sm:size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    {item.value === null ? (
                      "—"
                    ) : (
                      <CountUp value={item.value} suffix={item.suffix} />
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{item.label}</p>
                </div>
              </div>
            );
          })}
        </FadeIn>

        {/* Toolbar */}
        <FadeIn className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span id="matches-sort-label" className="text-xs font-medium text-muted-foreground">
              Sort by
            </span>
            <div
              role="group"
              aria-labelledby="matches-sort-label"
              className="inline-flex rounded-xl border border-border bg-muted/60 p-1"
            >
              {SORTS.map((s) => {
                const pressed = sortBy === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setSortBy(s.value)}
                    className={cn(
                      "relative rounded-lg px-3.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      pressed ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {pressed && (
                      <motion.span
                        layoutId="matches-sort-pill"
                        transition={SPRING.snappy}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-lg bg-card shadow-[inset_0_1px_0_0_var(--highlight),0_1px_3px_0_var(--shadow-color)]"
                      />
                    )}
                    <span className="relative">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <Label htmlFor="matches-search" className="sr-only">
              Search mentors by name or domain
            </Label>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="matches-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or domain"
              className="pl-10"
            />
          </div>
        </FadeIn>

        {visible.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center"
          >
            <Search className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" role="status">
              No mentors match your filter.
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </motion.div>
        ) : (
          <LayoutGroup>
            <ul className="grid gap-5">
              <AnimatePresence initial={false}>
                {visible.map((match, i) => {
                  const key = match.match_id || match.mentor_id || match._rank;
                  const status = String(match.status || "pending").toLowerCase();
                  const showMeeting =
                    (status === "meeting_scheduled" || status === "completed") && match.meeting;
                  const isTop = match._rank === 1;

                  return (
                    <motion.li
                      key={key}
                      layout
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                      transition={SPRING.soft}
                      className={cn(
                        "relative",
                        isTop &&
                          "mt-3 rounded-[calc(1.125rem+1px)] bg-gradient-to-br from-primary via-primary/30 to-spark p-px shadow-glow"
                      )}
                    >
                      {isTop && (
                        <span className="absolute -top-3 left-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_60%)] px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-soft">
                          <Crown className="size-3" aria-hidden="true" />
                          Top match
                        </span>
                      )}
                      <MentorCard
                        mentor={match}
                        matchScore={match.match_score}
                        index={i}
                        variant="match"
                        onEmailClick={openEmailDialog}
                        className={isTop ? "border-transparent" : undefined}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Status</span>
                            <StatusBadge status={status} />
                          </div>
                          <span
                            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                            aria-label={`Rank ${match._rank}`}
                          >
                            <span aria-hidden="true" className="text-foreground">
                              #{match._rank}
                            </span>
                            <span aria-hidden="true">match</span>
                          </span>
                        </div>

                        {status === "accepted" && (
                          <BookingSection match={match} onBooked={markBooked} />
                        )}
                        {showMeeting && (
                          <div className="mt-4">
                            <MeetingCard meeting={match.meeting} mentorName={match.name} />
                          </div>
                        )}
                      </MentorCard>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </LayoutGroup>
        )}
      </PageShell>

      <EmailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mentor={activeMentor}
        startupProfile={startupProfile}
        onSent={markSent}
      />
    </>
  );
}

export default function MatchesPage() {
  return (
    <AuthGuard requiredRole="startup">
      <MatchesPageContent />
    </AuthGuard>
  );
}
