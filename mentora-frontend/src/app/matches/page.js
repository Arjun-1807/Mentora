"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { StateCard, InlineError } from "@/components/StateCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Copy, ExternalLink, Loader2, UserSearch } from "lucide-react";
import { draftIntroEmail, matchMentors } from "@/lib/api";
import { getStoredMatches, getStoredProfile, setStoredMatches } from "@/lib/storage";

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "");
  return initials.join("") || "?";
}

function scorePercent(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)));
}

function EmailDialog({ open, onOpenChange, mentor, startupProfile, onDrafted }) {
  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const mentorName = mentor?.name || "this mentor";

  useEffect(() => {
    if (!open || !mentor) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSubject("");
    setBody("");

    draftIntroEmail(startupProfile, mentor, mentor.match_id)
      .then((data) => {
        if (cancelled) return;
        setSubject(data?.subject || `Introduction request — ${mentor.name || "Mentora"}`);
        setBody(data?.body || "");
        onDrafted?.(mentor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not generate the intro email.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `reloadKey` is the retry trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mentor, startupProfile, reloadKey]);

  const ready = !loading && !error;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast.success("Draft copied to your clipboard.");
    } catch {
      toast.error("Could not copy — select the text and copy manually.");
    }
  }

  function handleOpenInMailClient() {
    const to = mentor?.email || "";
    const params = new URLSearchParams({ subject, body });
    window.location.href = `mailto:${to}?${params.toString()}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Intro email draft</DialogTitle>
          <DialogDescription>
            Drafted for {mentorName}. Mentora never sends mail on your behalf —
            edit this, then copy it or open it in your own mail client.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <span className="sr-only">Drafting your intro email</span>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
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
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-body">Body</Label>
              <Textarea
                id="email-body"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {!mentor?.email && (
              <p className="text-xs text-muted-foreground">
                We don&apos;t have an address for {mentorName}, so your mail
                client will open with an empty “To” field.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!ready}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy draft
          </Button>
          <Button type="button" onClick={handleOpenInMailClient} disabled={!ready}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in mail client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MatchesPageContent() {
  const [matches, setMatches] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [startupProfile, setStartupProfile] = useState(null);
  const [activeMentor, setActiveMentor] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [error, setError] = useState("");
  const [emailedIds, setEmailedIds] = useState(() => new Set());

  useEffect(() => {
    setMatches(getStoredMatches());
    setStartupProfile(getStoredProfile());
    setHydrated(true);
  }, []);

  const runMatch = useCallback(
    async (profile) => {
      if (!profile || rematching) return;
      setRematching(true);
      setError("");
      try {
        const data = await matchMentors(profile);
        const list = Array.isArray(data) ? data : data?.matches || [];
        setStoredMatches(list);
        setMatches(list);
        if (list.length === 0) {
          toast.info("No mentors matched this profile yet.");
        }
      } catch (err) {
        setError(err.message || "Could not refresh your mentor matches.");
      } finally {
        setRematching(false);
      }
    },
    [rematching]
  );

  function openEmailDialog(mentor) {
    setActiveMentor(mentor);
    setDialogOpen(true);
  }

  const markEmailed = useCallback((mentor) => {
    const key = mentor?.match_id || mentor?.mentor_id;
    if (!key) return;
    setEmailedIds((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  if (!hydrated) {
    return (
      <PageShell>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <PageShell width="lg" center>
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
          {startupProfile ? (
            <StateCard
              icon={UserSearch}
              title="No mentor matches yet"
              description="Your startup profile is ready — run the matching to see the mentors best suited to help you."
              actions={
                <>
                  <Button
                    type="button"
                    onClick={() => runMatch(startupProfile)}
                    disabled={rematching}
                  >
                    {rematching && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {rematching ? "Finding mentors…" : "Find my mentors"}
                  </Button>
                  <Button variant="outline" render={<Link href="/profile" />}>
                    Review profile
                  </Button>
                </>
              }
            />
          ) : (
            <StateCard
              icon={UserSearch}
              title="No mentor matches yet"
              description="Upload a pitch deck first — matching runs on the startup profile we extract from it."
              actions={<Button render={<Link href="/upload" />}>Upload a pitch deck</Button>}
            />
          )}
        </div>
      </PageShell>
    );
  }

  const topMatches = matches.slice(0, 5);

  return (
    <>
      <PageShell>
        <PageHeader
          align="center"
          title="Your top mentor matches"
          description="Ranked by fit with your startup profile. Draft an intro email to any of them — you stay in control of what actually gets sent."
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

        <div className="grid gap-5">
          {topMatches.map((mentor, i) => {
            const percent = scorePercent(mentor.match_score);
            const key = mentor.match_id || mentor.mentor_id || i;
            const emailed = emailedIds.has(mentor.match_id || mentor.mentor_id);

            return (
              <Card key={key}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar size="lg">
                        <AvatarFallback>{initialsFor(mentor.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <CardTitle className="text-lg truncate">
                          {mentor.name || "Unnamed mentor"}
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{mentor.domain || "General"}</Badge>
                          {mentor.stage_focus && (
                            <span className="text-xs text-muted-foreground">
                              {mentor.stage_focus} stage
                            </span>
                          )}
                          {emailed && (
                            <Badge variant="outline">Draft opened</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center justify-center bg-muted h-8 w-8 shrink-0 text-sm font-semibold text-muted-foreground"
                      aria-label={`Rank ${i + 1}`}
                    >
                      {i + 1}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  {Array.isArray(mentor.expertise) && mentor.expertise.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-5">
                      {mentor.expertise.map((skill, idx) => (
                        <Badge key={idx} variant="outline">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Match score
                    </span>
                    <span className="text-sm font-semibold text-primary">
                      {percent === null ? "—" : `${percent}%`}
                    </span>
                  </div>
                  <Progress
                    value={percent ?? 0}
                    aria-label={`Match score for ${mentor.name || "this mentor"}`}
                  />

                  <div className="mt-5 flex justify-end">
                    <Button type="button" onClick={() => openEmailDialog(mentor)}>
                      <Mail className="h-4 w-4" aria-hidden="true" />
                      Draft intro email
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

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
      </PageShell>

      <EmailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mentor={activeMentor}
        startupProfile={startupProfile}
        onDrafted={markEmailed}
      />
    </>
  );
}

export default function MatchesPage() {
  return (
    <AuthGuard>
      <MatchesPageContent />
    </AuthGuard>
  );
}
