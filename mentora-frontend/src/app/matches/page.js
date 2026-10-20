"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search, UserSearch } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import MentorCard from "@/components/ui/MentorCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { StateCard, InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import EmailDialog from "@/components/matches/EmailDialog";
import BookingSection from "@/components/matches/BookingSection";
import MeetingCard from "@/components/matches/MeetingCard";
import { mergeLiveStatuses, toStartupProfilePayload } from "@/components/matches/matchData";
import { getAllMatches, matchMentors } from "@/lib/api";
import { getStoredMatches, getStoredProfile, setStoredMatches } from "@/lib/storage";

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
      <PageWrapper key="loading" className="max-w-4xl">
        <Skeleton className="mx-auto mb-3 h-9 w-72" />
        <Skeleton className="mx-auto mb-10 h-5 w-full max-w-md" />
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </PageWrapper>
    );
  }

  if (matches.length === 0) {
    return (
      <PageWrapper key="empty" className="max-w-lg">
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
                    {rematching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {rematching ? "Searching…" : "Search again"}
                  </Button>
                )}
              </>
            }
          />
        </div>
      </PageWrapper>
    );
  }

  return (
    <>
      <PageWrapper className="max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your Top Mentor Matches</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ranked by domain fit, stage alignment, and mentor track record.
          </p>
        </div>

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

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span id="matches-sort-label" className="text-xs font-medium text-muted-foreground">
              Sort by
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[sortBy]}
              onValueChange={(next) => {
                // Single-select: ignore the "un-press the active item" event.
                const picked = next.find((v) => v !== sortBy) ?? next[0];
                if (picked) setSortBy(picked);
              }}
              aria-labelledby="matches-sort-label"
            >
              {SORTS.map((s) => (
                <ToggleGroupItem
                  key={s.value}
                  value={s.value}
                  className="px-3 aria-pressed:border-primary/50 aria-pressed:bg-primary/15 aria-pressed:text-primary"
                >
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="relative w-full sm:w-64">
            <Label htmlFor="matches-search" className="sr-only">
              Search mentors by name or domain
            </Label>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="matches-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or domain"
              className="pl-8"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground" role="status">
            No mentors match your filter.
          </p>
        ) : (
          <div className="grid gap-5">
            {visible.map((match, i) => {
              const key = match.match_id || match.mentor_id || match._rank;
              const status = String(match.status || "pending").toLowerCase();
              const showMeeting =
                (status === "meeting_scheduled" || status === "completed") && match.meeting;

              return (
                <MentorCard
                  key={key}
                  mentor={match}
                  matchScore={match.match_score}
                  index={i}
                  variant="match"
                  onEmailClick={openEmailDialog}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Status</span>
                      <StatusBadge status={status} />
                    </div>
                    <span className="text-xs text-muted-foreground" aria-label={`Rank ${match._rank}`}>
                      #{match._rank} match
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
              );
            })}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => runMatch(startupProfile)}
            disabled={rematching || !startupProfile}
          >
            {rematching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {rematching ? "Refreshing…" : "Refresh matches"}
          </Button>
          <Button variant="ghost" render={<Link href="/dashboard" />}>
            View dashboard
          </Button>
        </div>
      </PageWrapper>

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
