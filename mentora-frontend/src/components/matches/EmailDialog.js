"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Mail, Send } from "lucide-react";
import { InlineError } from "@/components/StateCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftIntroEmail, requestIntro } from "@/lib/api";
import { toMentorPayload, toStartupProfilePayload } from "@/components/matches/matchData";

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

function MentorSummary({ mentor }) {
  const name = mentor?.name || "This mentor";
  const expertise = Array.isArray(mentor?.expertise) ? mentor.expertise : [];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {initialsFor(mentor?.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          {mentor?.domain && (
            <Badge variant="outline" className="mt-1">
              {mentor.domain}
            </Badge>
          )}
        </div>
      </div>
      {expertise.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Expertise
          </p>
          <div className="flex flex-wrap gap-1.5">
            {expertise.map((skill, i) => (
              <Badge key={i} variant="outline" className="text-[11px]">
                {skill}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <p className="flex items-center gap-1.5 break-all text-xs text-muted-foreground">
        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {mentor?.email || "No email on file"}
      </p>
    </div>
  );
}

/**
 * Two-panel intro email dialog. On open it drafts an email via POST /email
 * (nothing is sent yet), lets the founder edit it, and on "Send" calls
 * POST /matches/{match_id}/request, which emails the mentor from the backend
 * and moves the match to "requested". `startupProfile` is optional: without
 * it the backend drafts from the startup's active profile. `onSent` receives
 * the updated match.
 */
export default function EmailDialog({ open, onOpenChange, mentor, startupProfile, onSent }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const mentorName = mentor?.name || "this mentor";

  useEffect(() => {
    if (!open || !mentor) return undefined;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSubject("");
    setBody("");

    draftIntroEmail(toStartupProfilePayload(startupProfile), toMentorPayload(mentor), mentor.match_id)
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
  const canSend = ready && !sending && Boolean(mentor?.match_id) && subject.trim() && body.trim();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Copied!");
    } catch {
      toast.error("Could not copy — select the text and copy manually.");
    }
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    let result;
    try {
      // The backend looks the mentor's address up itself and marks the
      // match "requested" once the email is out.
      result = await requestIntro(mentor.match_id, { subject: subject.trim(), body: body.trim() });
    } catch (err) {
      // Network failures already raised the "Server unavailable" toast.
      if (err.status !== 0) {
        toast.error(err.message || "Failed to send the intro. Please try again.");
      }
      setSending(false);
      return;
    }

    toast.success(
      result?.delivery === "log"
        ? `Intro to ${mentorName} recorded (email delivery is in log mode on this server).`
        : `Intro sent to ${mentorName}`
    );
    onOpenChange(false);
    setSending(false);
    onSent?.(result?.match ? { ...mentor, ...result.match } : { ...mentor, status: "requested" });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send an intro to {mentorName}</DialogTitle>
          <DialogDescription>
            We drafted a personalised intro from your profile. Edit anything before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:w-[35%] md:shrink-0">
            <MentorSummary mentor={mentor} />
          </div>

          <div className="min-w-0 md:w-[65%]">
            {loading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                <span className="sr-only">Drafting your intro email</span>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-52 w-full" />
              </div>
            ) : error ? (
              <InlineError message={error}>
                <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
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
                    aria-describedby="email-body-count"
                    className="field-sizing-fixed min-h-52 resize-y"
                  />
                  <p id="email-body-count" className="text-right text-xs tabular-nums text-muted-foreground">
                    {body.length} characters
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mentora sends this from its own address with your email as the reply-to, and
                  marks the match as requested. {mentorName} can then accept or decline.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCopy} disabled={!ready || sending || !body}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy Body
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {sending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
