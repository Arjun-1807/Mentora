import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Display label + badge tone for every match status. Shared so tables, cards
 * and dialogs all agree (see CONTRACT: match status vocabulary). `className`
 * is kept for callers that style their own chips from this map.
 */
export const STATUS_STYLES = {
  pending: {
    label: "Pending",
    variant: "secondary",
    className: "border-border bg-muted text-muted-foreground",
  },
  emailed: { label: "Email Sent", variant: "info", className: "border-info/25 bg-info/12 text-info" },
  email_sent: {
    label: "Email Sent",
    variant: "info",
    className: "border-info/25 bg-info/12 text-info",
  },
  accepted: {
    label: "Accepted",
    variant: "success",
    className: "border-success/25 bg-success/12 text-success",
  },
  declined: {
    label: "Declined",
    variant: "danger",
    className: "border-destructive/25 bg-destructive/12 text-destructive",
  },
  meeting_scheduled: {
    label: "Meeting Scheduled",
    variant: "soft",
    className: "border-primary/25 bg-primary/12 text-primary",
  },
  completed: {
    label: "Completed",
    variant: "success",
    className: "border-success/50 bg-transparent text-success",
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

/** Status pill with a small leading dot in the status colour. */
export default function StatusBadge({ status, className }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <Badge variant="outline" className={cn("gap-1.5", style.className, className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </Badge>
  );
}
