import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Display label + colour classes for every match status. Shared so tables,
 * cards and dialogs all agree (see CONTRACT: match status vocabulary).
 */
export const STATUS_STYLES = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground border-transparent" },
  emailed: {
    label: "Email Sent",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  email_sent: {
    label: "Email Sent",
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
  meeting_scheduled: {
    label: "Meeting Scheduled",
    className: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-transparent text-emerald-300 border-emerald-500/60",
  },
};

/** Human label for a status, e.g. "meeting_scheduled" -> "Meeting Scheduled". */
export function statusLabel(status) {
  const known = STATUS_STYLES[status];
  if (known) return known.label;
  if (!status) return "Pending";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusBadge({ status, className }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <Badge variant="outline" className={cn(style.className, className)}>
      {statusLabel(status)}
    </Badge>
  );
}
