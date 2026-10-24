"use client";

import { CountUp, SpotlightCard } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function decimalsFor(value) {
  if (Number.isInteger(value)) return 0;
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(2, text.length - dot - 1);
}

const TONES = {
  primary: "bg-primary/12 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  spark: "bg-spark/14 text-spark",
};

/**
 * Dashboard KPI tile: icon chip, label, and a large value that counts up
 * when scrolled into view. `value` may be a number (animated, keeps its
 * decimals — 4.3 stays 4.3), a string (shown as-is) or null/undefined ("—").
 * `trend` starting with "+" renders in the success colour, "-" in danger.
 * `tone` picks the icon chip colour.
 */
export default function StatCard({
  icon,
  label,
  value,
  trend,
  loading = false,
  tone = "primary",
  className,
}) {
  const shown = value ?? "—";
  const numeric = typeof shown === "number" && Number.isFinite(shown);
  const trendText = typeof trend === "string" ? trend.trim() : trend;

  return (
    <SpotlightCard className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]",
              TONES[tone] ?? TONES.primary
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight text-foreground">
            {numeric ? (
              <CountUp value={shown} decimals={decimalsFor(shown)} />
            ) : (
              <span className="tabular-nums">{shown}</span>
            )}
          </p>
        )}
      </div>
      {trendText && !loading ? (
        <p
          className={cn(
            "mt-2 text-xs font-medium",
            typeof trendText === "string" && trendText.startsWith("+")
              ? "text-success"
              : typeof trendText === "string" && trendText.startsWith("-")
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {trendText}
        </p>
      ) : null}
    </SpotlightCard>
  );
}
