"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const VALUES = [1, 2, 3, 4, 5];

/**
 * Keyboard-operable 1–5 star rating with ARIA radio-group semantics.
 *
 * Roving tabindex: exactly one star is in the tab order, arrow keys move
 * between stars (and select, as a radio group should), Home/End jump to the
 * ends, and each star is labelled for screen readers. Hovering previews the
 * rating; each star springs on hover and pops when it becomes selected.
 */
export function StarRating({
  value = 0,
  onChange,
  disabled = false,
  label = "Satisfaction rating",
  id,
}) {
  const containerRef = useRef(null);
  const [hovered, setHovered] = useState(0);

  function select(next) {
    const clamped = Math.min(5, Math.max(1, next));
    onChange?.(clamped);
    const el = containerRef.current?.querySelector(`[data-star="${clamped}"]`);
    el?.focus();
  }

  function handleKeyDown(e) {
    if (disabled) return;
    const current = value || 0;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        select(current === 0 ? 1 : current + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        select(current === 0 ? 1 : current - 1);
        break;
      case "Home":
        e.preventDefault();
        select(1);
        break;
      case "End":
        e.preventDefault();
        select(5);
        break;
      default:
        break;
    }
  }

  // With nothing selected, the first star holds the tab stop.
  const tabStop = value >= 1 && value <= 5 ? value : 1;

  const shown = !disabled && hovered ? hovered : value;

  return (
    <div
      ref={containerRef}
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      onPointerLeave={() => setHovered(0)}
      className="flex items-center gap-0.5"
    >
      {VALUES.map((n) => {
        const filled = n <= shown;
        const preview = Boolean(hovered) && !disabled && n <= hovered && n > value;
        return (
          <motion.button
            key={n}
            type="button"
            data-star={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} out of 5 star${n > 1 ? "s" : ""}`}
            tabIndex={n === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => !disabled && onChange?.(n)}
            onPointerEnter={() => !disabled && setHovered(n)}
            whileHover={disabled ? undefined : { scale: 1.18, rotate: -6 }}
            whileTap={disabled ? undefined : { scale: 0.88 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            className={cn(
              "rounded-lg p-1 outline-none",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            )}
          >
            <motion.span
              className="flex"
              // Re-keyed on selection so the chosen star (and those below it) pop.
              key={filled && !preview ? `on-${value}` : "off"}
              initial={filled && !preview ? { scale: 0.6 } : false}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 14, delay: (n - 1) * 0.03 }}
            >
              <Star
                aria-hidden="true"
                className={cn(
                  "size-6 transition-colors duration-150",
                  filled
                    ? preview
                      ? "fill-spark/40 text-spark"
                      : "fill-spark text-spark drop-shadow-[0_0_6px_color-mix(in_oklch,var(--spark)_45%,transparent)]"
                    : "text-muted-foreground/60"
                )}
              />
            </motion.span>
          </motion.button>
        );
      })}
      <span
        className="ml-2 min-w-14 font-mono text-xs tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {value ? `${value}/5` : "Not rated"}
      </span>
    </div>
  );
}
