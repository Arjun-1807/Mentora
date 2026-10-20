"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowRight, ArrowUp, HeartPulse, Info } from "lucide-react";
import ScoreRing from "@/components/ui/ScoreRing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { getHealth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dateLabel } from "@/components/dashboard/helpers";

const Sparkline = dynamic(() => import("@/components/dashboard/Sparkline"), {
  ssr: false,
  loading: () => <Skeleton className="h-12 w-full" />,
});

const TREND = {
  up: { icon: ArrowUp, className: "text-emerald-400", label: "Up" },
  down: { icon: ArrowDown, className: "text-red-400", label: "Down" },
  stable: { icon: ArrowRight, className: "text-muted-foreground", label: "Steady" },
};

export function TrendArrow({ trend, withLabel = false, className }) {
  const meta = TREND[trend] || TREND.stable;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1", meta.className, className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
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
            className="inline-flex rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-primary" aria-hidden="true" />
          Startup Health Score
          <HealthInfo />
        </CardTitle>
        <CardDescription>Updated each time a meeting outcome is logged.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center gap-5">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ) : error ? (
          <InlineError message={error}>
            <Button type="button" size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </InlineError>
        ) : score === null ? (
          <div className="flex items-center gap-5">
            <ScoreRing value={0} size={80} stroke={6} thresholds="health" label="No health score yet">
              <span className="text-2xl font-bold text-muted-foreground">—</span>
            </ScoreRing>
            <p className="text-sm text-muted-foreground">
              No score yet. After your first mentor meeting, log how it went and
              your health score will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing
              value={score}
              size={80}
              stroke={6}
              thresholds="health"
              label={`Health score ${Math.round(score)} out of 100`}
            >
              <span className="text-2xl font-bold">{Math.round(score)}</span>
            </ScoreRing>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="flex items-center gap-1.5 text-sm">
                <TrendArrow trend={data?.trend} withLabel />
                <span className="text-muted-foreground">vs last meeting</span>
              </p>
              <Sparkline history={history} limit={10} height={48} />
              {data?.last_updated && (
                <p className="text-xs text-muted-foreground">
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
