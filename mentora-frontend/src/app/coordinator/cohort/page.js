"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  CalendarCheck,
  ChevronDown,
  Download,
  HeartPulse,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import { StateCard, InlineError } from "@/components/StateCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import StatCard from "@/components/ui/StatCard";
import { EASE_OUT, SPRING } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendArrow } from "@/components/dashboard/HealthScoreCard";
import { cohortCsv, dateLabel, healthTone, sortCohort } from "@/components/dashboard/helpers";
import { getCohortHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

const Sparkline = dynamic(() => import("@/components/dashboard/Sparkline"), {
  ssr: false,
  loading: () => <Skeleton className="h-16 w-full rounded-lg" />,
});

/** Badge tone + bar colour per health band (semantic tokens, both themes). */
const TONE_STYLE = {
  good: { badge: "success", bar: "bg-success", label: "Healthy" },
  fair: { badge: "warning", bar: "bg-warning", label: "Watch" },
  poor: { badge: "danger", bar: "bg-destructive", label: "Needs attention" },
  none: { badge: "secondary", bar: "bg-muted-foreground/30", label: "No score" },
};

/** Filter pills above the table; `all` plus one per health band. */
const FILTERS = [
  { id: "all", label: "All" },
  { id: "poor", label: "Needs attention" },
  { id: "fair", label: "Watch" },
  { id: "good", label: "Healthy" },
  { id: "none", label: "No score" },
];

const COLUMN_COUNT = 7;

function HealthBadge({ score }) {
  const tone = healthTone(score);
  const style = TONE_STYLE[tone];
  return (
    <span className="flex items-center gap-2.5">
      <Badge variant={style.badge} className="min-w-9 font-mono tabular-nums">
        {tone === "none" ? "—" : Math.round(score)}
        {tone === "none" && <span className="sr-only">No health score yet</span>}
      </Badge>
      {tone !== "none" && (
        <span aria-hidden="true" className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted lg:block">
          <motion.span
            className={cn("block h-full origin-left rounded-full", style.bar)}
            style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.15 }}
          />
        </span>
      )}
    </span>
  );
}

function rowKey(row, i) {
  return row.user_id || row.email || String(i);
}

function downloadCsv(rows) {
  const csv = cohortCsv(rows);
  // BOM so Excel opens UTF-8 (non-ASCII names/domains) correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mentora-cohort-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CohortContent() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [direction, setDirection] = useState("asc");
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getCohortHealth()
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data?.startups) ? data.startups : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load the cohort.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const sorted = useMemo(() => sortCohort(rows, direction), [rows, direction]);

  // Keys/panel ids come from the full sorted list so they stay stable when filtering.
  const keyed = useMemo(
    () => sorted.map((row, i) => ({ row, i, key: rowKey(row, i), tone: healthTone(row.health_score) })),
    [sorted]
  );
  const visible = filter === "all" ? keyed : keyed.filter((entry) => entry.tone === filter);

  const summary = useMemo(() => {
    const counts = { all: rows.length, good: 0, fair: 0, poor: 0, none: 0 };
    let scoreSum = 0;
    let scored = 0;
    let meetings = 0;
    for (const row of rows) {
      counts[healthTone(row.health_score)] += 1;
      if (typeof row.health_score === "number" && !Number.isNaN(row.health_score)) {
        scoreSum += row.health_score;
        scored += 1;
      }
      if (typeof row.meeting_count === "number") meetings += row.meeting_count;
    }
    return { counts, avg: scored ? Math.round(scoreSum / scored) : null, meetings };
  }, [rows]);

  function handleExport() {
    if (sorted.length === 0) return;
    try {
      downloadCsv(sorted);
    } catch {
      toast.error("Could not generate the CSV.");
    }
  }

  function toggle(key) {
    setExpanded((current) => (current === key ? null : key));
  }

  const statsLoading = loading && rows.length === 0;

  return (
    <PageWrapper className="px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-2.5">Coordinator</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Cohort{" "}
            <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
              overview
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
            Lowest health first, so you can see who needs attention. Startups with no logged
            meetings yet are listed at the bottom.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={handleExport} disabled={loading || sorted.length === 0}>
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {!error && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<Users />} tone="primary" label="Startups" value={summary.counts.all} loading={statsLoading} />
          <StatCard
            icon={<HeartPulse />}
            tone="success"
            label="Avg Health"
            value={summary.avg ?? "—"}
            trend={summary.avg === null ? "No scores yet" : "Across scored startups"}
            loading={statsLoading}
          />
          <StatCard
            icon={<AlertTriangle />}
            tone="warning"
            label="Needs Attention"
            value={summary.counts.poor}
            trend="Health below 40"
            loading={statsLoading}
          />
          <StatCard
            icon={<CalendarCheck />}
            tone="info"
            label="Meetings Logged"
            value={summary.meetings}
            loading={statsLoading}
          />
        </div>
      )}

      <Card className="gap-0 py-0">
        {!error && sorted.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div
              role="group"
              aria-label="Filter by health"
              className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1"
            >
              {FILTERS.map((f) => {
                const selected = filter === f.id;
                const count = summary.counts[f.id];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFilter(f.id);
                      setExpanded(null);
                    }}
                    aria-pressed={selected}
                    className={cn(
                      "relative isolate inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId="cohort-filter"
                        transition={SPRING.snappy}
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 rounded-full bg-primary/12 ring-1 ring-primary/25"
                      />
                    )}
                    {f.id !== "all" && (
                      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_STYLE[f.id].bar)} />
                    )}
                    {f.label}
                    <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
              Showing {visible.length} of {sorted.length}
            </p>
          </div>
        )}

        <CardContent className={cn("px-0", (loading && rows.length === 0) || error || sorted.length === 0 ? "p-5" : "")}>
          {loading && rows.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <InlineError message={error}>
              <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </Button>
            </InlineError>
          ) : sorted.length === 0 ? (
            <StateCard
              icon={Users}
              title="No startups yet"
              description="Startups appear here once they register on Mentora."
              variant="plain"
            />
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No startups in this group right now.</p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFilter("all")}>
                Show all startups
              </Button>
            </div>
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-5">Startup</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead aria-sort={direction === "asc" ? "ascending" : "descending"}>
                    <button
                      type="button"
                      onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
                      className="-mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Health Score
                      <motion.span
                        animate={{ rotate: direction === "asc" ? 0 : 180 }}
                        transition={SPRING.snappy}
                        className="flex text-primary"
                      >
                        <ArrowDown className="size-3.5" aria-hidden="true" />
                      </motion.span>
                      <span className="sr-only">
                        {direction === "asc" ? "(lowest first, click for highest first)" : "(highest first, click for lowest first)"}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead className="w-12 pr-5">
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ row, i, key }, position) => {
                  const open = expanded === key;
                  const panelId = `cohort-row-${i}`;
                  const label = row.email || row.domain || "this startup";
                  return (
                    <Fragment key={key}>
                      <motion.tr
                        data-slot="table-row"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: EASE_OUT, delay: Math.min(position, 12) * 0.025 }}
                        onClick={() => toggle(key)}
                        className={cn(
                          "cursor-pointer border-b border-border transition-colors hover:bg-muted/40",
                          open && "bg-primary/[0.05] hover:bg-primary/[0.07]"
                        )}
                        data-state={open ? "selected" : undefined}
                      >
                        <TableCell className="max-w-[18rem] py-3 pl-5">
                          <span className="flex items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-[11px] font-semibold uppercase text-primary"
                            >
                              {String(row.domain || row.email || "?").slice(0, 2)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">{row.email || "—"}</span>
                              {row.domain && (
                                <span className="block truncate text-xs text-muted-foreground">{row.domain}</span>
                              )}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          {row.stage ? (
                            <Badge variant="outline" className="capitalize">
                              {row.stage}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <HealthBadge score={row.health_score} />
                        </TableCell>
                        <TableCell>
                          {typeof row.health_score === "number" ? (
                            <TrendArrow trend={row.trend} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {typeof row.meeting_count === "number" ? row.meeting_count : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateLabel(row.last_activity)}
                        </TableCell>
                        <TableCell className="pr-5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(key);
                            }}
                            aria-expanded={open}
                            aria-controls={open ? panelId : undefined}
                            aria-label={`${open ? "Hide" : "Show"} health history for ${label}`}
                            className={cn(
                              "inline-flex size-7 items-center justify-center rounded-lg outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                              open ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            <motion.span
                              animate={{ rotate: open ? 180 : 0 }}
                              transition={SPRING.snappy}
                              className="flex"
                            >
                              <ChevronDown className="size-4" aria-hidden="true" />
                            </motion.span>
                          </button>
                        </TableCell>
                      </motion.tr>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/25 p-0">
                            <motion.div
                              id={panelId}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              transition={{ duration: 0.35, ease: EASE_OUT }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-3 px-5 py-4">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                  <span className="font-mono uppercase tracking-[0.12em]">
                                    Health history (last {Math.min(10, row.health_history?.length || 0)} entries)
                                  </span>
                                  <span>
                                    {typeof row.match_count === "number" ? `${row.match_count} matches · ` : ""}
                                    {typeof row.meeting_count === "number" ? `${row.meeting_count} meetings` : ""}
                                  </span>
                                </div>
                                <div className="rounded-xl border border-border bg-card p-3">
                                  <Sparkline
                                    history={row.health_history}
                                    limit={10}
                                    height={64}
                                    label={`Health history for ${label}`}
                                  />
                                </div>
                              </div>
                            </motion.div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  );
}

export default function CohortPage() {
  return (
    <AuthGuard requiredRole="coordinator">
      <main className="flex-1">
        <CohortContent />
      </main>
    </AuthGuard>
  );
}
