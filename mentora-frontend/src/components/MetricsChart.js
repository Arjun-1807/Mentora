"use client";

import { useId } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

// Single series, so a single hue (--chart-1) and no legend; the metric cards
// above the chart double as its table view. The bars fade from full colour at
// the top to a soft tint at the baseline.
const chartConfig = {
  value: { label: "Score", color: "var(--chart-1)" },
};

/** Bar chart comparing the retrieval metrics (all on a 0–1 scale). */
export default function MetricsChart({ data }) {
  const gradientId = `metrics-bar-${useId().replace(/:/g, "")}`;
  const summary = data.map((d) => `${d.metric} ${d.value.toFixed(3)}`).join(", ");

  return (
    <figure className="mt-2">
      <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">Metrics side by side</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          0–1 · higher is better
        </span>
      </figcaption>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-64 w-full"
        role="img"
        aria-label={`Bar chart of retrieval metrics: ${summary}`}
      >
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-value)" stopOpacity={1} />
              <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
          <XAxis
            dataKey="metric"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6, radius: 8 }}
            content={
              <ChartTooltipContent
                hideIndicator
                formatter={(value) => (
                  <span className="font-mono tabular-nums text-foreground">
                    {Number(value).toFixed(3)}
                  </span>
                )}
              />
            }
          />
          <Bar
            dataKey="value"
            fill={`url(#${gradientId})`}
            radius={[8, 8, 2, 2]}
            maxBarSize={52}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
