"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DURATION_MS = 1000;
const TICK_MS = 16;

function decimalsFor(value) {
  if (Number.isInteger(value)) return 0;
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(2, text.length - dot - 1);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Counts 0 -> target over 1s with setInterval; keeps the target's decimals (4.3 stays 4.3). */
function useCountUp(target) {
  const numeric = typeof target === "number" && Number.isFinite(target);
  const decimals = numeric ? decimalsFor(target) : 0;
  const [current, setCurrent] = useState(numeric ? 0 : target);

  useEffect(() => {
    if (!numeric) {
      setCurrent(target);
      return undefined;
    }
    if (target === 0 || prefersReducedMotion()) {
      setCurrent(target);
      return undefined;
    }
    const steps = Math.round(DURATION_MS / TICK_MS);
    let step = 0;
    setCurrent(0);
    const id = setInterval(() => {
      step += 1;
      if (step >= steps) {
        setCurrent(target);
        clearInterval(id);
        return;
      }
      const eased = 1 - Math.pow(1 - step / steps, 3);
      setCurrent(target * eased);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [numeric, target]);

  if (!numeric) return current;
  return Number(current).toFixed(decimals);
}

/**
 * Dashboard KPI tile: 3px primary left border, icon in a muted circle
 * top-right, value counting up from 0 on mount. `value` may be a number
 * (animated), a string (shown as-is) or null/undefined ("—").
 * `trend` starting with "+" renders green, with "-" red.
 */
export default function StatCard({ icon, label, value, trend, loading = false, className }) {
  const display = useCountUp(value ?? "—");
  const trendText = typeof trend === "string" ? trend.trim() : trend;

  return (
    <Card
      className={cn(
        "relative gap-0 border-l-[3px] border-l-primary py-5 pl-5 pr-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          {loading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
              {display}
            </p>
          )}
        </div>
        {icon && (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary [&_svg]:h-5 [&_svg]:w-5"
          >
            {icon}
          </span>
        )}
      </div>
      {trendText && !loading ? (
        <p
          className={cn(
            "mt-2 text-xs",
            typeof trendText === "string" && trendText.startsWith("+")
              ? "text-emerald-400"
              : typeof trendText === "string" && trendText.startsWith("-")
                ? "text-red-400"
                : "text-muted-foreground"
          )}
        >
          {trendText}
        </p>
      ) : null}
    </Card>
  );
}
