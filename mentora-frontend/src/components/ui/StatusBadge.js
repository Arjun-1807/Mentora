import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Display label + colour classes for every match status (the lifecycle in
 * mentora-backend/app/services/matches.py). Shared so tables, cards and
 * dialogs all agree.
 */
export const STATUS_STYLES = {
  suggested: { label: "Suggested", className: "bg-muted text-muted-foreground border-transparent" },
  requested: {
    label: "Requested",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  declined: {
    label: "Declined",
    className: "bg-red-500/15 text-red-300 border-red-500/30",
  },
  withdrawn: {
    label: "Withdrawn",
    className: "bg-transparent text-muted-foreground border-border",
  },
  expired: {
    label: "Expired",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  meeting_scheduled: {
    label: "Meeting scheduled",
    className: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  met: {
    label: "Met",
    className: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-transparent text-emerald-300 border-emerald-500/60",
  },
  superseded: {
    label: "Superseded",
    className: "bg-transparent text-muted-foreground border-dashed border-border",
  },
};

/** Legacy spellings older match records may still carry. */
const LEGACY_STATUS = { pending: "suggested", emailed: "suggested", email_sent: "requested" };

/** Lifecycle status for a raw value (legacy spellings mapped, default "suggested"). */
export function normaliseStatus(status) {
  const raw = String(status || "suggested").toLowerCase();
  return LEGACY_STATUS[raw] || raw;
}

/** Human label for a status, e.g. "meeting_scheduled" -> "Meeting scheduled". */
export function statusLabel(status) {
  const known = STATUS_STYLES[normaliseStatus(status)];
  if (known) return known.label;
  const text = String(status).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function StatusBadge({ status, className }) {
  const style = STATUS_STYLES[normaliseStatus(status)] || STATUS_STYLES.suggested;
  return (
    <Badge variant="outline" className={cn(style.className, className)}>
      {statusLabel(status)}
    </Badge>
  );
}
