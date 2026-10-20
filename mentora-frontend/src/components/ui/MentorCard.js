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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: index * 0.08 }}
      whileHover={{
        y: -3,
        boxShadow: "0 18px 40px -20px rgb(0 0 0 / 0.75)",
        transition: { duration: 0.2 },
      }}
      className={cn(
        "rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 shadow-sm transition-shadow duration-200",
        className
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-bold text-foreground">{name}</h3>
              {mentor.domain && <Badge variant="outline">{mentor.domain}</Badge>}
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
                    <Badge
                      variant="outline"
                      className="h-auto py-0.5 text-[11px] font-normal text-muted-foreground"
                    >
                      {item}
                    </Badge>
                  </li>
                ))}
                {overflow > 0 && (
                  <li>
                    <Badge
                      variant="outline"
                      className="h-auto py-0.5 text-[11px] font-normal text-muted-foreground"
                    >
                      +{overflow} more
                    </Badge>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          {score !== null && (
            <div className="flex items-center gap-2">
              <ScoreRing value={score} size={48} stroke={4} label={`Match score ${Math.round(score)}%`}>
                <span className="text-[11px]">{Math.round(score)}%</span>
              </ScoreRing>
              <span className="text-xs text-muted-foreground sm:hidden">match</span>
            </div>
          )}

          {variant === "request" ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                Send Intro Email
              </Button>
            )
          )}
        </div>
      </div>

      {children ? <div className="border-t border-border px-4 py-4 sm:px-5">{children}</div> : null}
    </motion.article>
  );
}
