"use client";

import { useRef } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const VALUES = [1, 2, 3, 4, 5];

/**
 * Keyboard-operable 1–5 star rating with ARIA radio-group semantics.
 *
 * Roving tabindex: exactly one star is in the tab order, arrow keys move
 * between stars (and select, as a radio group should), Home/End jump to the
 * ends, and each star is labelled for screen readers.
 */
export function StarRating({
  value = 0,
  onChange,
  disabled = false,
  label = "Satisfaction rating",
  id,
}) {
  const containerRef = useRef(null);

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

  return (
    <div
      ref={containerRef}
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-1"
    >
      {VALUES.map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            data-star={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} out of 5 star${n > 1 ? "s" : ""}`}
            tabIndex={n === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => !disabled && onChange?.(n)}
            className={cn(
              "p-1 outline-none transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border focus-visible:border-ring",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            )}
          >
            <Star
              aria-hidden="true"
              className={cn(
                "h-5 w-5",
                filled ? "fill-primary text-primary" : "text-muted-foreground"
              )}
            />
          </button>
        );
      })}
      <span className="ml-2 text-sm text-muted-foreground" aria-hidden="true">
        {value ? `${value}/5` : "Not rated"}
      </span>
    </div>
  );
}
