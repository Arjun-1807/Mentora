"use client";

import { motion } from "framer-motion";
import { Check, Loader2, Mail, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ScoreRing from "@/components/ui/ScoreRing";
import { cn } from "@/lib/utils";

const MAX_EXPERTISE = 4;
const EASE_OUT = [0.22, 1, 0.36, 1];

export function initialsOf(name) {
  const parts = String(name || "")
    .replace(/@.*$/, "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
}

/** Accepts 0-1 or 0-100 and returns 0-100 (or null when missing). */
export function normaliseScore(score) {
  const n = Number(score);
  if (score === null || score === undefined || score === "" || !Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Mentor summary card used on /matches (variant "match") and the mentor
 * dashboard (variant "request", where `mentor` describes the startup asking).
 *
 * `busy` disables the action buttons; pass "accept" / "decline" to also show
 * a spinner on that button. `children` renders under the card body.
 */
export default function MentorCard({
  mentor = {},
  matchScore,
  index = 0,
  variant = "match",
  onEmailClick,
  onAccept,
  onDecline,
  busy = false,
  children,
  className,
}) {
  const name = mentor.name || mentor.email || "Mentor";
  const score = normaliseScore(matchScore);
  const expertise = toList(mentor.expertise);
  const shown = expertise.slice(0, MAX_EXPERTISE);
  const overflow = expertise.length - shown.length;
  const stages = toList(mentor.stage_focus);

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: index * 0.07 }}
      whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 28 } }}
      className={cn(
        "surface group/mentor relative overflow-hidden rounded-2xl transition-shadow duration-300 hover:shadow-lift",
        className
      )}
    >
      {/* Accent bar that grows in on hover. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-gradient-to-b from-primary to-spark transition-transform duration-500 ease-out group-hover/mentor:scale-y-100"
      />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            aria-hidden="true"
            className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/90 to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-base font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                {name}
              </h3>
              {mentor.domain && <Badge variant="soft">{mentor.domain}</Badge>}
              {stages.map((stage) => (
                <Badge key={stage} variant="secondary" className="capitalize">
                  {stage}
                </Badge>
              ))}
            </div>
            {shown.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Expertise">
                {shown.map((item) => (
                  <li key={item}>
                    <span className="inline-flex rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {item}
                    </span>
                  </li>
                ))}
                {overflow > 0 && (
                  <li>
                    <span className="inline-flex rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{overflow} more
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4 sm:justify-end sm:border-t-0 sm:pt-0">
          {score !== null && (
            <div className="flex items-center gap-2.5">
              <ScoreRing value={score} size={52} stroke={4} label={`Match score ${Math.round(score)}%`}>
                <span className="text-[11px]">{Math.round(score)}%</span>
              </ScoreRing>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                match
              </span>
            </div>
          )}

          {variant === "request" ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => onDecline?.(mentor)}
                disabled={Boolean(busy)}
              >
                {busy === "decline" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <X aria-hidden="true" />
                )}
                Decline
              </Button>
              <Button type="button" onClick={() => onAccept?.(mentor)} disabled={Boolean(busy)}>
                {busy === "accept" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                Accept
              </Button>
            </div>
          ) : (
            onEmailClick && (
              <Button type="button" onClick={() => onEmailClick(mentor)} disabled={Boolean(busy)}>
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                Send intro
              </Button>
            )
          )}
        </div>
      </div>

      {children ? (
        <div className="border-t border-border bg-muted/25 px-5 py-5 sm:px-6">{children}</div>
      ) : null}
    </motion.article>
  );
}
