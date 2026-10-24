"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Theme-aware ring colours (CSS variables, so they flip with light/dark). */
export const SCORE_COLORS = {
  green: "var(--success)",
  amber: "var(--warning)",
  orange: "var(--spark)",
  red: "var(--destructive)",
};

/**
 * Picks the ring colour for a 0-100 score.
 *   match:      >80 green, 60-80 amber, <60 orange
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
 * Circular SVG progress ring. The stroke sweeps from empty to `value` when
 * it scrolls into view (and re-animates when `value` changes), with a soft
 * glow in the same colour. `children` render centred inside the ring; by
 * default the rounded value is shown.
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
  const glowId = useId().replace(/:/g, "");

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label || `${Math.round(clamped)} out of 100`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90 overflow-visible"
      >
        <defs>
          <filter id={`glow-${glowId}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={Math.max(1.5, stroke * 0.6)} />
          </filter>
        </defs>
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
          opacity={0.45}
          filter={`url(#glow-${glowId})`}
          initial={{ strokeDashoffset: circumference }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
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
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold tabular-nums text-foreground"
      >
        {children ?? Math.round(clamped)}
      </span>
    </div>
  );
}
