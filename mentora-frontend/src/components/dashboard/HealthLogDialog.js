"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/components/StarRating";
import { InlineError } from "@/components/StateCard";
import { logHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAX_NOTES = 1000;

const COPY = {
  startup: {
    blockers: "Were your blockers resolved?",
    engagement: "How engaged was the mentor?",
  },
  mentor: {
    blockers: "Were the startup's blockers resolved?",
    engagement: "How engaged were you able to be in this session?",
  },
};

/** Accessible Yes/No choice (radio-group semantics, arrow keys switch). */
function YesNo({ id, value, onChange, disabled, labelledBy }) {
  function onKeyDown(e) {
    if (disabled) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const next = value === true ? false : true;
      onChange(next);
      e.currentTarget.querySelector(`[data-choice="${next ? "yes" : "no"}"]`)?.focus();
    }
  }
  const options = [
    { key: "yes", label: "Yes", val: true },
    { key: "no", label: "No", val: false },
  ];
  const tabStop = value === false ? "no" : "yes";
  return (
    <div
      id={id}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-lg border border-border p-0.5"
    >
      {options.map((opt) => {
        const selected = value === opt.val;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            data-choice={opt.key}
            aria-checked={selected}
            tabIndex={opt.key === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.val)}
            className={cn(
              "min-w-16 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              selected
                ? opt.val
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Post-meeting "Log Outcome" dialog → POST /health/log.
 *
 * `role` ("startup" | "mentor") only changes the wording; `counterpartName`
 * is who the meeting was with. `onLogged(match, {health_score, trend})` fires
 * after a successful submit (the dialog closes itself).
 */
export default function HealthLogDialog({ open, onOpenChange, match, role = "startup", counterpartName, onLogged }) {
  const [momentum, setMomentum] = useState(0);
  const [engagement, setEngagement] = useState(0);
  const [resolved, setResolved] = useState(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setMomentum(0);
      setEngagement(0);
      setResolved(null);
      setNotes("");
      setError("");
    }
  }, [open]);

  const copy = COPY[role] || COPY.startup;
  const ready = momentum >= 1 && engagement >= 1 && resolved !== null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    if (!match?.match_id) {
      setError("This match is missing its id, so the outcome can't be linked to it.");
      return;
    }
    if (!ready) {
      setError("Answer all three questions before submitting.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        match_id: match.match_id,
        momentum_score: momentum,
        blockers_resolved: resolved,
        mentor_engagement: engagement,
      };
      const trimmed = notes.trim();
      if (trimmed) payload.notes = trimmed;
      const result = await logHealth(payload);
      toast.success("Outcome logged. Health score updated.");
      onLogged?.(match, result);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Could not log this outcome.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Log meeting outcome</DialogTitle>
            <DialogDescription>
              How did your meeting{counterpartName ? ` with ${counterpartName}` : ""} go? This
              updates the startup&apos;s health score.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>How much momentum did this add?</Label>
            <StarRating
              label="Momentum, 1 to 5 stars"
              value={momentum}
              onChange={setMomentum}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label id="health-blockers-label">{copy.blockers}</Label>
            <YesNo
              value={resolved}
              onChange={setResolved}
              disabled={submitting}
              labelledBy="health-blockers-label"
            />
          </div>

          <div className="space-y-2">
            <Label>{copy.engagement}</Label>
            <StarRating
              label="Engagement, 1 to 5 stars"
              value={engagement}
              onChange={setEngagement}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="health-notes">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="health-notes"
              rows={3}
              maxLength={MAX_NOTES}
              placeholder="Any highlights or next steps?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {notes.length}/{MAX_NOTES}
            </p>
          </div>

          {error && <InlineError message={error} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !ready}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
