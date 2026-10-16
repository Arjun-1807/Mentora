"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Axis-less health-score trend line (0–100). `history` = [{score, timestamp}],
 * oldest first; only the last `limit` points are drawn. The chart is
 * decorative for screen readers — the summary goes in the aria-label.
 */
export default function Sparkline({ history, limit = 10, height = 48, className, label }) {
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
        <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={[0, 100]} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--primary)"
            strokeWidth={2}
            // A single point can't draw a line, so show it as a dot instead.
            dot={points.length === 1 ? { r: 3, fill: "var(--primary)" } : false}
            activeDot={false}
            isAnimationActive
            animationDuration={800}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
