"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Horizontal step tracker. `steps` is a list of labels and `current` the
 * 0-indexed active step: earlier steps show a filled check, the current one
 * a pulsing ring, later ones an empty muted circle. Each step takes an equal
 * column; a connector line runs from each circle to the next one.
 */
export default function StepIndicator({ steps = [], current = 0, className }) {
  return (
    <nav aria-label="Progress" className={cn("w-full", className)}>
      <ol className="flex items-start">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const last = i === steps.length - 1;
          return (
            <li
              key={`${label}-${i}`}
              className="relative flex flex-1 flex-col items-center text-center"
              aria-current={active ? "step" : undefined}
            >
              {!last && (
                <span
                  aria-hidden="true"
                  className="absolute top-4 left-[calc(50%+1.5rem)] right-[calc(-50%+1.5rem)] h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-border"
                >
                  <span
                    className={cn(
                      "block h-full bg-primary transition-[width] duration-500 ease-out",
                      done ? "w-full" : "w-0"
                    )}
                  />
                </span>
              )}
              <span className="relative flex h-8 w-8 items-center justify-center">
                {active && (
                  <span
                    aria-hidden="true"
                    className="step-pulse-ring absolute inset-0 rounded-full bg-primary/35"
                  />
                )}
                <span
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors duration-300",
                    done && "border-primary bg-primary text-white",
                    active && "border-primary bg-primary text-primary-foreground",
                    !done && !active && "border-border bg-muted/40 text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : i + 1}
                </span>
              </span>
              <span
                className={cn(
                  "mt-2 px-1 text-xs sm:text-sm leading-tight",
                  active ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {label}
                <span className="sr-only">
                  {done ? " (completed)" : active ? " (current)" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
