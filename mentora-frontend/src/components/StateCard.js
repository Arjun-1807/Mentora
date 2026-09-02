import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared empty / error / dead-end panel. Always give the user something to do
 * next via `actions` so a failed call or missing data can't strand them.
 */
export function StateCard({
  icon: Icon,
  title,
  description,
  actions,
  tone = "muted",
  className,
}) {
  const isError = tone === "error";
  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        {Icon && (
          <span
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center",
              isError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="space-y-2">
          <h2
            className={cn(
              "text-base font-semibold",
              isError ? "text-destructive" : "text-foreground"
            )}
          >
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </CardContent>
    </Card>
  );
}

/** Inline error line with an optional retry affordance. */
export function InlineError({ message, className, children }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <span>{message}</span>
      {children}
    </div>
  );
}
