"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Clock, FileUp, Loader2, Repeat2, Search, Undo2, UserSearch } from "lucide-react";
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
import { statusOf } from "@/components/dashboard/helpers";
import { useStartupJourney } from "@/hooks/use-startup-journey";
import { matchMentors, withdrawRequest } from "@/lib/api";

const STAGE_ORDER = { idea: 0, mvp: 1, growth: 2, all: 3 };
const CLOSED_STATUSES = new Set(["declined", "withdrawn", "expired"]);
const MEETING_STATUSES = new Set(["meeting_scheduled", "met", "completed"]);

const SORTS = [
  { value: "score", label: "Score" },
  { value: "domain", label: "Domain" },
  { value: "stage", label: "Stage" },
];

function scoreOf(m) {
  const s = m.match_score ?? m.score;
  return typeof s === "number" ? s : -1;
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

function StatusDetail({ match, onWithdraw, withdrawing, onBooked }) {
  const status = statusOf(match);
  const name = match.name || "this mentor";

  if (status === "requested") {
    return (
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Intro sent — waiting for {name} to accept. Requests expire after 7 days.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => onWithdraw(match)} disabled={withdrawing}>
          {withdrawing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
          Withdraw request
        </Button>
      </div>
    );
  }
  if (status === "accepted") return <BookingSection match={match} onBooked={onBooked} />;
  if (MEETING_STATUSES.has(status) && match.meeting) {
    return (
      <div className="mt-4">
        <MeetingCard meeting={match.meeting} mentorName={name} />
      </div>
    );
  }
  if (CLOSED_STATUSES.has(status)) {
    const why = {
      declined: `${name} declined this request.`,
      withdrawn: "You withdrew this request.",
      expired: `${name} didn't answer within 7 days.`,
    }[status];
    return <p className="mt-3 text-xs text-muted-foreground">{why} We added another suggestion in its place.</p>;
  }
  return null;
}

function MatchesPageContent() {
  const { profile, matches, loaded, error, reload, replaceMatch } = useStartupJourney();
  const [activeMatch, setActiveMatch] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [actionError, setActionError] = useState("");
  const [withdrawing, setWithdrawing] = useState(null);
  const [sortBy, setSortBy] = useState("score");
  const [query, setQuery] = useState("");

  const runMatch = useCallback(async () => {
    if (rematching) return;
    setRematching(true);
    setActionError("");
    try {
      // Empty body: the backend matches on the active server-side profile.
      await matchMentors();
      reload();
    } catch (err) {
      setActionError(err.message || "Could not refresh your mentor matches.");
    } finally {
      setRematching(false);
    }
  }, [rematching, reload]);

  const handleWithdraw = useCallback(
    async (match) => {
      setWithdrawing(match.match_id);
      try {
        const res = await withdrawRequest(match.match_id);
        replaceMatch(res?.match);
        toast.success(`Request to ${match.name || "the mentor"} withdrawn.`);
        reload(); // picks up the replacement suggestion
      } catch (err) {
        if (err.status !== 0) toast.error(err.message || "Could not withdraw this request.");
      } finally {
        setWithdrawing(null);
      }
    },
    [replaceMatch, reload]
  );

  const handleSent = useCallback((updated) => replaceMatch(updated), [replaceMatch]);
  const handleBooked = useCallback(
    (match, meeting) => replaceMatch({ ...match, status: "meeting_scheduled", meeting }),
    [replaceMatch]
  );

  const names = useMemo(() => {
    const out = {};
    for (const m of matches || []) out[m.match_id] = m.name;
    return out;
  }, [matches]);

  const { open, closed } = useMemo(() => {
    const list = Array.isArray(matches) ? matches : [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (m) =>
            String(m.name || "").toLowerCase().includes(q) || String(m.domain || "").toLowerCase().includes(q)
        )
      : list;
    return {
      open: sortMatches(filtered.filter((m) => !CLOSED_STATUSES.has(statusOf(m))), sortBy),
      closed: filtered.filter((m) => CLOSED_STATUSES.has(statusOf(m))),
    };
  }, [matches, query, sortBy]);

  if (matches === null && !loaded) {
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

  if (loaded && error && !matches?.length) {
    return (
      <PageWrapper key="error" className="max-w-lg">
        <InlineError message={error}>
          <Button type="button" size="sm" variant="outline" onClick={reload}>
            Try again
          </Button>
        </InlineError>
      </PageWrapper>
    );
  }

  if (loaded && !profile && !matches?.length) {
    return (
      <PageWrapper key="no-profile" className="max-w-lg">
        <StateCard
          icon={FileUp}
          title="Upload your pitch deck first"
          description="We match mentors to the profile we extract from your deck."
          actions={<Button render={<Link href="/upload" />}>Upload a pitch deck</Button>}
        />
      </PageWrapper>
    );
  }

  if (!matches?.length) {
    return (
      <PageWrapper key="empty" className="max-w-lg">
        <div className="space-y-4">
          {actionError && <InlineError message={actionError} />}
          <StateCard
            icon={UserSearch}
            title="No matches yet"
            description="Run matching on your current profile, or re-upload a more detailed deck."
            actions={
              <>
                <Button type="button" onClick={runMatch} disabled={rematching}>
                  {rematching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {rematching ? "Searching…" : "Find my mentors"}
                </Button>
                <Button variant="outline" render={<Link href="/upload" />}>
                  Re-upload deck
                </Button>
              </>
            }
          />
        </div>
      </PageWrapper>
    );
  }

  const renderCard = (match, i) => {
    const status = statusOf(match);
    const replacedName = match.replacement_for_name || names[match.replacement_for];
    return (
      <MentorCard
        key={match.match_id || match._id}
        mentor={match}
        matchScore={match.match_score ?? match.score}
        index={i}
        variant="match"
        onEmailClick={
          status === "suggested"
            ? () => {
                setActiveMatch(match);
                setDialogOpen(true);
              }
            : undefined
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Status</span>
            <StatusBadge status={status} />
          </div>
          {match.replacement_for && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
              Replacement for {replacedName || "an earlier match"}
            </span>
          )}
        </div>
        <StatusDetail
          match={match}
          onWithdraw={handleWithdraw}
          withdrawing={withdrawing === match.match_id}
          onBooked={handleBooked}
        />
      </MentorCard>
    );
  };

  return (
    <>
      <PageWrapper className="max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your Mentor Matches</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ranked by domain fit, stage alignment, and mentor track record. Send an intro to request a mentor.
          </p>
        </div>

        {(actionError || (error && loaded)) && (
          <InlineError message={actionError || error} className="mb-6">
            <Button type="button" size="sm" variant="outline" onClick={actionError ? runMatch : reload}>
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

        {open.length === 0 && closed.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground" role="status">
            No mentors match your filter.
          </p>
        ) : (
          <div className="grid gap-5">{open.map(renderCard)}</div>
        )}

        {closed.length > 0 && (
          <section className="mt-10" aria-labelledby="closed-heading">
            <h2 id="closed-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
              Closed requests
            </h2>
            <div className="grid gap-4 opacity-80">{closed.map((m, i) => renderCard(m, open.length + i))}</div>
          </section>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button type="button" variant="outline" onClick={runMatch} disabled={rematching || !profile}>
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
        mentor={activeMatch}
        onSent={handleSent}
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
