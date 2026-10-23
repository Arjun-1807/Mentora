"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/components/motion";

/**
 * Shared empty / error / dead-end panel. Always give the user something to do
 * next via `actions` so a failed call or missing data can't strand them.
 * The icon sits in a softly glowing tile with a dashed orbit ring.
 * `variant="plain"` drops the card surface, for use inside another card.
 */
export function StateCard({
  icon: Icon,
  title,
  description,
  actions,
  tone = "muted",
  variant = "card",
  className,
}) {
  const isError = tone === "error";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
      className={cn(
        "relative w-full overflow-hidden rounded-2xl px-6 py-10 text-center",
        variant === "card" && "surface",
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-1/2 top-0 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl",
          isError ? "bg-destructive/15" : "bg-primary/15"
        )}
      />
      <div className="relative flex flex-col items-center gap-4">
        {Icon && (
          <span className="relative flex size-14 items-center justify-center">
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-[-6px] rounded-[20px] border border-dashed",
                isError ? "border-destructive/30" : "border-primary/30"
              )}
            />
            <span
              className={cn(
                "flex size-14 items-center justify-center rounded-2xl",
                isError ? "bg-destructive/12 text-destructive" : "bg-primary/12 text-primary"
              )}
            >
              <Icon className="size-6" aria-hidden="true" />
            </span>
          </span>
        )}
        <div className="space-y-2">
          <h2
            className={cn(
              "text-lg font-semibold tracking-tight",
              isError ? "text-destructive" : "text-foreground"
            )}
          >
            {title}
          </h2>
          {description && (
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
      </div>
    </motion.div>
  );
}

/** Inline error line with an optional retry affordance. */
export function InlineError({ message, className, children }) {
  if (!message) return null;
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <span className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {message}
      </span>
      {children}
    </motion.div>
  );
}
