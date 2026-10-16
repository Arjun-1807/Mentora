"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const SCORE_COLORS = {
  green: "oklch(0.696 0.17 162.48)",
  amber: "oklch(0.85 0.18 85)",
  orange: "oklch(0.65 0.2 30)",
  red: "oklch(0.704 0.191 22.216)",
};

/**
 * Picks the ring colour for a 0-100 score.
 *   match:      >80 green, 60-80 amber, <60 orange-red
 *   health:     >=70 green, 40-69 amber, <40 red
 *   confidence: >=80 green, 40-79 amber, <40 red
 */
export function scoreColor(value, thresholds = "match") {
  const v = Number(value) || 0;
  if (thresholds === "health") {
    if (v >= 70) return SCORE_COLORS.green;
    if (v >= 40) return SCORE_COLORS.amber;
    return SCORE_COLORS.red;
  }
  if (thresholds === "confidence") {
    if (v >= 80) return SCORE_COLORS.green;
    if (v >= 40) return SCORE_COLORS.amber;
    return SCORE_COLORS.red;
  }
  if (v > 80) return SCORE_COLORS.green;
  if (v >= 60) return SCORE_COLORS.amber;
  return SCORE_COLORS.orange;
}

/**
 * Circular SVG progress ring. The stroke animates from empty to `value` on
 * mount (and re-animates when `value` changes). `children` render centred
 * inside the ring; by default the rounded value is shown.
 */
export default function ScoreRing({
  value,
  size = 48,
  stroke = 4,
  color,
  children,
  thresholds = "match",
  className,
  label,
}) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const ringColor = color || scoreColor(clamped, thresholds);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label || `${Math.round(clamped)} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground"
      >
        {children ?? Math.round(clamped)}
      </span>
    </div>
  );
}
