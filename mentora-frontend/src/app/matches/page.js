"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { StateCard, InlineError } from "@/components/StateCard";
import { FadeIn, HoverCard, useCountUp } from "@/components/motion";
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
import { Mail, Copy, Send, Loader2, UserSearch, CheckCircle2 } from "lucide-react";
import { draftIntroEmail, matchMentors, sendEmail, updateMatchStatus } from "@/lib/api";
import { getStoredMatches, getStoredProfile, setStoredMatches } from "@/lib/storage";

/** Statuses at or beyond "an intro email was actually delivered". */
const SENT_STATUSES = new Set(["email_sent", "completed"]);

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

function stageLabel(stage) {
  if (!stage) return null;
  return String(stage).toLowerCase() === "all" ? "All stages" : `${stage} stage`;
}

/** Score bar + number that count up from 0 when the card mounts. */
function MatchScore({ score, mentorName }) {
  const percent = scorePercent(score);
  const current = useCountUp(percent ?? 0, { duration: 1100 });

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Match Score
        </span>
        <span className="text-sm font-semibold text-primary tabular-nums">
          {percent === null ? "—" : `${current}%`}
        </span>
      </div>
      <Progress value={current} aria-label={`Match score for ${mentorName}`} />
    </>
  );
}

function EmailDialog({ open, onOpenChange, mentor, startupProfile, onSent }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
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
  const canSend = ready && !sending && Boolean(mentor?.email) && subject.trim() && body.trim();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast.success("Draft copied to your clipboard.");
    } catch {
      toast.error("Could not copy — select the text and copy manually.");
    }
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      await sendEmail({ to: mentor.email, subject: subject.trim(), body: body.trim() });
    } catch (err) {
      // Network failures already raised the "Server unavailable" toast.
      if (err.status !== 0) toast.error("Failed to send email. Check your API key.");
      setSending(false);
      return;
    }

    toast.success(`Email sent to ${mentorName}`);
    onOpenChange(false);
    setSending(false);

    // The email is already out; a failed status update shouldn't read as a
    // failed send, so it gets its own, softer message.
    if (mentor.match_id) {
      try {
        await updateMatchStatus(mentor.match_id, "email_sent");
      } catch {
        toast.warning("Email sent, but the match status couldn't be updated.");
      }
    }
    onSent?.(mentor);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reach out to {mentorName}</DialogTitle>
          <DialogDescription>
            We drafted a personalised intro from your profile. Edit anything you
            like before sending.
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
            {mentor?.email && (
              <p className="text-xs text-muted-foreground">
                To: <span className="text-foreground">{mentor.email}</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-body">Body</Label>
              <Textarea
                id="email-body"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
              />
            </div>
            {!mentor?.email && (
              <p className="text-xs text-muted-foreground">
                We don&apos;t have an email address for {mentorName} yet — copy
                the draft and send it yourself. Refreshing your matches may pick
                up newly added contact details.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!ready || sending}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy draft
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MatchesPageContent() {
  const router = useRouter();
  const [matches, setMatches] = useState(null);
  const [startupProfile, setStartupProfile] = useState(null);
  const [activeMentor, setActiveMentor] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // `null` = matching never ran for this profile (vs. `[]` = ran, no hits).
    const stored = getStoredMatches();
    if (stored === null) {
      toast.info("Please complete your profile first.", { id: "matches-missing" });
      router.replace("/profile");
      return;
    }
    setMatches(stored);
    setStartupProfile(getStoredProfile());
  }, [router]);

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

  const markSent = useCallback((mentor) => {
    setMatches((prev) => {
      if (!prev) return prev;
      const next = prev.map((m) =>
        (m.match_id && m.match_id === mentor.match_id) ||
        (!m.match_id && m.mentor_id === mentor.mentor_id)
          ? { ...m, status: "email_sent" }
          : m
      );
      // Persist so the "Intro sent" badge survives a reload.
      setStoredMatches(next);
      return next;
    });
  }, []);

  if (matches === null) {
    return (
      <PageShell key="loading">
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (matches.length === 0) {
    return (
      <PageShell key="empty" width="lg" center>
        <FadeIn className="space-y-4">
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
                    {rematching && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {rematching ? "Searching…" : "Search again"}
                  </Button>
                )}
              </>
            }
          />
        </FadeIn>
      </PageShell>
    );
  }

  const topMatches = matches.slice(0, 5);

  return (
    <>
      <PageShell>
        <PageHeader
          align="center"
          title="Your Top Mentor Matches"
          description="Ranked by domain fit, stage alignment, and mentor track record."
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
            const key = mentor.match_id || mentor.mentor_id || i;
            const sent = SENT_STATUSES.has(String(mentor.status || "").toLowerCase());
            const name = mentor.name || "Unnamed mentor";

            return (
              <HoverCard key={key}>
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar size="lg">
                          <AvatarFallback>{initialsFor(mentor.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <CardTitle className="text-lg truncate">{name}</CardTitle>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{mentor.domain || "General"}</Badge>
                            {stageLabel(mentor.stage_focus) && (
                              <span className="text-xs text-muted-foreground">
                                {stageLabel(mentor.stage_focus)}
                              </span>
                            )}
                            {sent && (
                              <Badge variant="outline">
                                <CheckCircle2 aria-hidden="true" />
                                Intro sent
                              </Badge>
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

                    <MatchScore score={mentor.match_score} mentorName={name} />

                    <div className="mt-5 flex justify-end">
                      <Button
                        type="button"
                        variant={sent ? "outline" : "default"}
                        onClick={() => openEmailDialog(mentor)}
                      >
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        {sent ? "Send another intro" : "Reach out"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </HoverCard>
            );
          })}
        </div>

        <FadeIn className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
        </FadeIn>
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
    <AuthGuard>
      <MatchesPageContent />
    </AuthGuard>
  );
}
