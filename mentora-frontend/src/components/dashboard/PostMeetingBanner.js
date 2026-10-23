"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dateLabel, needsHealthLog } from "@/components/dashboard/helpers";

const MAX_SHOWN = 3;

/**
 * "How did your meeting with [name] go?" prompts, one per finished meeting
 * this role hasn't logged yet (see CONTRACT banner rule). `nameOf(match)`
 * returns who the meeting was with; `onLog(match)` opens the dialog.
 */
export default function PostMeetingBanner({ matches, role, nameOf, onLog }) {
  const pending = useMemo(
    () => (Array.isArray(matches) ? matches.filter((m) => needsHealthLog(m, role)) : []),
    [matches, role]
  );
  const shown = pending.slice(0, MAX_SHOWN);

  return (
    <div aria-live="polite" className={shown.length ? "mb-6 space-y-3" : undefined}>
      <AnimatePresence initial={false}>
        {shown.map((match) => {
          const name = nameOf?.(match) || "your match";
          return (
            <motion.div
              key={match.match_id || match._id}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, height: 0, marginTop: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(110deg,color-mix(in_oklch,var(--primary)_14%,var(--card))_0%,var(--card)_55%,color-mix(in_oklch,var(--spark)_10%,var(--card))_100%)] p-4 pl-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-spark"
              />
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]">
                  <CalendarCheck className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    How did your meeting with <span className="break-words">{name}</span> go?
                  </p>
                  {match.meeting?.date && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      Met on {dateLabel(match.meeting.date)}
                      {match.meeting.start_time ? ` at ${match.meeting.start_time}` : ""}
                    </p>
                  )}
                </div>
              </div>
              <Button type="button" size="sm" onClick={() => onLog?.(match)} className="self-start sm:self-auto">
                Log Outcome
                <ArrowRight aria-hidden="true" />
              </Button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {pending.length > MAX_SHOWN && (
        <p className="pl-1 text-xs text-muted-foreground">
          +{pending.length - MAX_SHOWN} more meeting{pending.length - MAX_SHOWN === 1 ? "" : "s"} to log.
        </p>
      )}
    </div>
  );
}
