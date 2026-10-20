"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck } from "lucide-react";
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
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    How did your meeting with <span className="break-words">{name}</span> go?
                  </p>
                  {match.meeting?.date && (
                    <p className="text-xs text-muted-foreground">
                      Met on {dateLabel(match.meeting.date)}
                      {match.meeting.start_time ? ` at ${match.meeting.start_time}` : ""}
                    </p>
                  )}
                </div>
              </div>
              <Button type="button" size="sm" onClick={() => onLog?.(match)} className="self-start sm:self-auto">
                Log Outcome
              </Button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {pending.length > MAX_SHOWN && (
        <p className="text-xs text-muted-foreground">
          +{pending.length - MAX_SHOWN} more meeting{pending.length - MAX_SHOWN === 1 ? "" : "s"} to log.
        </p>
      )}
    </div>
  );
}
