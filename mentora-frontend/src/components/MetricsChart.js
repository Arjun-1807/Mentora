"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

// Single series, so a single validated hue (--chart-1) and no legend; the
// metric cards above the chart double as its table view.
const chartConfig = {
  value: { label: "Score", color: "var(--chart-1)" },
};

/** Bar chart comparing the retrieval metrics (all on a 0–1 scale). */
export default function MetricsChart({ data }) {
  const summary = data.map((d) => `${d.metric} ${d.value.toFixed(3)}`).join(", ");

  return (
    <figure className="mt-6">
      <figcaption className="mb-3 text-sm font-medium text-foreground">
        Metrics side by side <span className="text-muted-foreground font-normal">(0–1, higher is better)</span>
      </figcaption>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-64 w-full"
        role="img"
        aria-label={`Bar chart of retrieval metrics: ${summary}`}
      >
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="metric" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ChartTooltip
            cursor={{ fillOpacity: 0.4 }}
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
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            animationDuration={900}
          />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
