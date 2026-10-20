"use client";

import { CalendarCheck, CalendarDays, ExternalLink, Video } from "lucide-react";
import { formatLongDate, formatSlotWindow } from "@/components/matches/slots";

/**
 * Confirmation card for a scheduled meeting. `meeting` follows the match-doc
 * shape: {title, date:"YYYY-MM-DD", start_time, end_time, meet_link, html_link}.
 */
export default function MeetingCard({ meeting, mentorName }) {
  if (!meeting) return null;
  const title = meeting.title || `Mentora meeting${mentorName ? ` with ${mentorName}` : ""}`;
  const hasTime = meeting.start_time && meeting.end_time;

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-300">
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Meeting scheduled</p>
          <p className="break-words font-semibold text-foreground">{title}</p>
          {meeting.date && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {formatLongDate(meeting.date)}
              {hasTime && ` · ${formatSlotWindow(meeting)}`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
            {meeting.meet_link ? (
              <a
                href={meeting.meet_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <Video className="h-4 w-4" aria-hidden="true" />
                Join Google Meet
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Video className="h-4 w-4" aria-hidden="true" />
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
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open in Google Calendar
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
