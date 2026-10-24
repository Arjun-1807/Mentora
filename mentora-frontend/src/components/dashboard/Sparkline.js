"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Axis-less health-score trend (0–100) drawn as a line over a soft gradient
 * fill. `history` = [{score, timestamp}], oldest first; only the last `limit`
 * points are drawn. The chart is decorative for screen readers — the summary
 * goes in the aria-label. `color` defaults to the primary token.
 */
export default function Sparkline({
  history,
  limit = 10,
  height = 48,
  className,
  label,
  color = "var(--chart-1)",
}) {
  const gradientId = `spark-${useId().replace(/:/g, "")}`;
  const points = (Array.isArray(history) ? history : [])
    .filter((p) => typeof p?.score === "number" && Number.isFinite(p.score))
    .slice(-limit)
    .map((p, i) => ({ i, score: Math.round(p.score * 10) / 10 }));

  if (points.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>No history yet.</p>
    );
  }

  const summary = `${label || "Health score trend"}, last ${points.length} ${
    points.length === 1 ? "entry" : "entries"
  }: ${points.map((p) => Math.round(p.score)).join(", ")}`;

  return (
    <div className={cn("w-full", className)} style={{ height }} role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 2, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <Area
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            // A single point can't draw a line, so show it as a dot instead.
            dot={points.length === 1 ? { r: 3, fill: color, strokeWidth: 0 } : false}
            activeDot={false}
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
