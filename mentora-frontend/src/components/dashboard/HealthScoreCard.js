"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowRight, ArrowUp, HeartPulse, Info } from "lucide-react";
import ScoreRing from "@/components/ui/ScoreRing";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { getHealth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dateLabel, healthTone } from "@/components/dashboard/helpers";

const Sparkline = dynamic(() => import("@/components/dashboard/Sparkline"), {
  ssr: false,
  loading: () => <Skeleton className="h-16 w-full" />,
});

/** Plain-language read of the score band, shown under the ring. */
const TONE_LABEL = {
  good: { label: "Healthy", variant: "success" },
  fair: { label: "Needs attention", variant: "warning" },
  poor: { label: "At risk", variant: "danger" },
};

const TREND_PILL = {
  up: "bg-success/12",
  down: "bg-destructive/12",
  stable: "bg-muted",
};

const TREND = {
  up: { icon: ArrowUp, className: "text-success", label: "Up" },
  down: { icon: ArrowDown, className: "text-destructive", label: "Down" },
  stable: { icon: ArrowRight, className: "text-muted-foreground", label: "Steady" },
};

export function TrendArrow({ trend, withLabel = false, className }) {
  const meta = TREND[trend] || TREND.stable;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1", meta.className, className)}>
      <Icon className="size-4" aria-hidden="true" />
      {withLabel ? <span>{meta.label}</span> : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

function HealthInfo() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="How the health score is calculated"
          />
        }
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 text-left leading-relaxed">
        Your score (0–100) blends your last 5 logged meetings: momentum each
        meeting added (50%), how engaged the mentor was (30%) and the share of
        meetings where your blockers got resolved (20%).
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "Startup Health Score" card: 80px ring, trend vs the previous meeting, and
 * a sparkline of the last 10 scores. Re-fetches whenever `refreshKey` changes.
 */
export default function HealthScoreCard({ startupId = "me", refreshKey = 0, className }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getHealth(startupId)
      .then((res) => {
        if (!cancelled) setData(res || null);
      })
      .catch((err) => {
        if (cancelled) return;
        // No record yet is the empty state, not an error.
        if (err?.status === 404) setData({ health_score: null, health_history: [] });
        else setError(err.message || "Could not load your health score.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startupId, refreshKey, retry]);

  const score = typeof data?.health_score === "number" ? data.health_score : null;
  const history = Array.isArray(data?.health_history) ? data.health_history : [];

  const tone = TONE_LABEL[healthTone(score)];

  return (
    <Card className={cn("relative h-full", className)}>
      {/* Soft halo behind the ring, tinted by the score band. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -left-16 -top-16 size-56 rounded-full blur-3xl",
          score === null
            ? "bg-primary/10"
            : healthTone(score) === "good"
              ? "bg-success/12"
              : healthTone(score) === "fair"
                ? "bg-warning/12"
                : "bg-destructive/12"
        )}
      />
      <CardHeader className="relative">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <HeartPulse className="size-4" aria-hidden="true" />
          </span>
          Startup Health Score
          <HealthInfo />
        </CardTitle>
        <CardDescription>Updated each time a meeting outcome is logged.</CardDescription>
      </CardHeader>
      <CardContent className="relative flex-1">
        {loading && !data ? (
          <div className="flex items-center gap-6">
            <Skeleton className="size-28 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ) : error ? (
          <InlineError message={error}>
            <Button type="button" size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </InlineError>
        ) : score === null ? (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing value={0} size={112} stroke={8} thresholds="health" label="No health score yet">
              <span className="text-3xl font-semibold text-muted-foreground">—</span>
            </ScoreRing>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              No score yet. After your first mentor meeting, log how it went and
              your health score will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="flex flex-col items-center gap-2.5">
              <ScoreRing
                value={score}
                size={112}
                stroke={8}
                thresholds="health"
                label={`Health score ${Math.round(score)} out of 100`}
              >
                <span className="flex flex-col items-center leading-none">
                  <span className="text-3xl font-semibold tracking-tight">{Math.round(score)}</span>
                  <span className="mt-1 text-[10px] font-normal text-muted-foreground">/ 100</span>
                </span>
              </ScoreRing>
              {tone && <Badge variant={tone.variant}>{tone.label}</Badge>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    TREND_PILL[data?.trend] || TREND_PILL.stable
                  )}
                >
                  <TrendArrow trend={data?.trend} withLabel />
                </span>
                <span className="text-muted-foreground">vs last meeting</span>
              </p>
              <Sparkline history={history} limit={10} height={72} />
              {data?.last_updated && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Last updated {dateLabel(data.last_updated, { withTime: true })}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
