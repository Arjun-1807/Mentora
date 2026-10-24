"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring", stiffness: 420, damping: 28 };

/**
 * Horizontal step tracker. `steps` is a list of labels and `current` the
 * 0-indexed active step: earlier steps show a check that pops in, the current
 * one a pulsing ring, later ones a muted outline. The connector between steps
 * fills with a gradient as each one completes.
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
                  className="absolute top-[18px] left-[calc(50%+1.5rem)] right-[calc(-50%+1.5rem)] h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-border"
                >
                  <motion.span
                    className="block h-full origin-left bg-gradient-to-r from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_50%)]"
                    initial={false}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
              )}
              <span className="relative flex size-9 items-center justify-center">
                {active && (
                  <span
                    aria-hidden="true"
                    className="step-pulse-ring absolute inset-0 rounded-full bg-primary/40"
                  />
                )}
                <motion.span
                  layout
                  animate={{ scale: active ? 1.05 : 1 }}
                  transition={SPRING}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300",
                    done && "border-primary bg-primary text-primary-foreground",
                    active &&
                      "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]",
                    !done && !active && "border-border bg-card text-muted-foreground"
                  )}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {done ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0 }}
                        transition={SPRING}
                        className="flex"
                      >
                        <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="num"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        {i + 1}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.span>
              </span>
              <span
                className={cn(
                  "mt-2.5 px-1 text-xs leading-tight sm:text-sm",
                  active
                    ? "font-medium text-foreground"
                    : done
                      ? "text-foreground/80"
                      : "text-muted-foreground"
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
