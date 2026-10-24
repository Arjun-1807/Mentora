"use client";

import { motion } from "framer-motion";
import { CalendarCheck, CalendarDays, Clock, ExternalLink, Video } from "lucide-react";
import { formatLongDate, formatSlotWindow, parseIsoDate } from "@/components/matches/slots";

/**
 * Confirmation card for a scheduled meeting. `meeting` follows the match-doc
 * shape: {title, date:"YYYY-MM-DD", start_time, end_time, meet_link, html_link}.
 * A tear-off style date block sits beside the details.
 */
export default function MeetingCard({ meeting, mentorName }) {
  if (!meeting) return null;
  const title = meeting.title || `Mentora meeting${mentorName ? ` with ${mentorName}` : ""}`;
  const hasTime = meeting.start_time && meeting.end_time;
  const date = parseIsoDate(meeting.date);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/8 p-4 sm:p-5"
      role="status"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/20 blur-3xl"
      />
      <div className="relative flex items-start gap-4">
        {date ? (
          <div
            aria-hidden="true"
            className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-center shadow-soft"
          >
            <span className="bg-primary py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
              {date.toLocaleDateString(undefined, { month: "short" })}
            </span>
            <span className="py-1 text-xl font-semibold leading-tight text-foreground">
              {date.getDate()}
            </span>
          </div>
        ) : (
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <CalendarCheck className="size-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 space-y-1.5">
          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
            <CalendarCheck className="size-3.5" aria-hidden="true" />
            Meeting scheduled
          </p>
          <p className="break-words font-semibold text-foreground">{title}</p>
          {meeting.date && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                {formatLongDate(meeting.date)}
              </span>
              {hasTime && (
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                  <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                  {formatSlotWindow(meeting)}
                </span>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            {meeting.meet_link ? (
              <a
                href={meeting.meet_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22)] transition-shadow hover:shadow-glow focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Video className="size-4" aria-hidden="true" />
                Join Google Meet
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Video className="size-4" aria-hidden="true" />
                Meet link will appear in your calendar invite
              </span>
            )}
            {meeting.html_link && (
              <a
                href={meeting.html_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Open in Google Calendar
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
