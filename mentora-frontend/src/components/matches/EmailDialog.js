"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Loader2, Mail, Send, Sparkles } from "lucide-react";
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
import { draftIntroEmail, sendEmail, updateMatchStatus } from "@/lib/api";
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
    <div className="relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-muted/40 p-4 sm:p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-br from-primary/25 via-primary/10 to-spark/15"
      />
      <div className="relative flex items-center gap-3 pt-4">
        <span
          className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-lg font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_0_0_4px_var(--popover)]"
          aria-hidden="true"
        >
          {initialsFor(mentor?.name)}
        </span>
        <div className="min-w-0 pt-3">
          <p className="truncate font-semibold tracking-tight">{name}</p>
          {mentor?.domain && (
            <Badge variant="soft" className="mt-1">
              {mentor.domain}
            </Badge>
          )}
        </div>
      </div>
      {expertise.length > 0 && (
        <div className="relative">
          <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Expertise
          </p>
          <div className="flex flex-wrap gap-1.5">
            {expertise.map((skill, i) => (
              <span
                key={i}
                className="inline-flex rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="relative mt-auto flex items-center gap-1.5 break-all rounded-lg bg-card px-2.5 py-2 text-xs text-muted-foreground">
        <Mail className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        {mentor?.email || "No email on file"}
      </p>
    </div>
  );
}

/**
 * Two-panel intro email dialog. On open it drafts an email via POST /email
 * (which also advances the match to "emailed"), lets the founder edit it, and
 * sends it through /api/send-email, then marks the match "email_sent".
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
  const canSend = ready && !sending && Boolean(mentor?.email) && subject.trim() && body.trim();

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
    try {
      await sendEmail({ to: mentor.email, subject: subject.trim(), body: body.trim() });
    } catch (err) {
      // Network failures already raised the "Server unavailable" toast.
      if (err.status !== 0) {
        toast.error(err.message || "Failed to send email. Check your Resend API key in .env.local.");
      }
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-medium text-primary">
            <Sparkles className="size-3" aria-hidden="true" />
            AI-drafted intro
          </span>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Send an intro to {mentorName}
          </DialogTitle>
          <DialogDescription>
            We drafted a personalised intro from your profile. Edit anything before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:w-[34%] md:shrink-0">
            <MentorSummary mentor={mentor} />
          </div>

          <div className="min-w-0 md:w-[66%]">
            <AnimatePresence mode="wait" initial={false}>
              {loading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3"
                  role="status"
                  aria-live="polite"
                >
                  <span className="sr-only">Drafting your intro email</span>
                  <p
                    aria-hidden="true"
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
                  >
                    <Sparkles className="size-4 animate-pulse text-primary" />
                    Drafting your intro…
                  </p>
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-56 w-full rounded-xl" />
                </motion.div>
              ) : error ? (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <InlineError message={error}>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                      Try again
                    </Button>
                  </InlineError>
                </motion.div>
              ) : (
                <motion.div
                  key="draft"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-sm">
                    <span className="text-muted-foreground">To</span>
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {mentor?.email || mentorName}
                    </span>
                  </div>
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
                      className="field-sizing-fixed min-h-56 resize-y"
                    />
                    <p
                      id="email-body-count"
                      className="text-right font-mono text-[11px] tabular-nums text-muted-foreground"
                    >
                      {body.length} characters
                    </p>
                  </div>
                  {!mentor?.email && (
                    <p className="rounded-xl border border-warning/25 bg-warning/10 px-3.5 py-2.5 text-xs leading-relaxed text-foreground">
                      We don&apos;t have an email address for {mentorName} yet — copy the draft and
                      send it yourself. Refreshing your matches may pick up newly added contact details.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCopy} disabled={!ready || sending || !body}>
            <Copy className="size-4" aria-hidden="true" />
            Copy Body
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {sending ? "Sending…" : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
