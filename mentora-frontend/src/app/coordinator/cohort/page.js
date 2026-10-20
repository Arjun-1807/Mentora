"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDownUp, ChevronDown, Download, Loader2, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import { StateCard, InlineError } from "@/components/StateCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  loading: () => <Skeleton className="h-16 w-full" />,
});

const TONE_CLASS = {
  good: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  fair: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  poor: "border-red-500/40 bg-red-500/15 text-red-300",
  none: "border-transparent bg-muted text-muted-foreground",
};

const COLUMN_COUNT = 7;

function HealthBadge({ score }) {
  const tone = healthTone(score);
  return (
    <Badge variant="outline" className={cn("tabular-nums", TONE_CLASS[tone])}>
      {tone === "none" ? "—" : Math.round(score)}
      {tone === "none" && <span className="sr-only">No health score yet</span>}
    </Badge>
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

  return (
    <PageWrapper>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cohort Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lowest health first, so you can see who needs attention. Startups with no logged
            meetings yet are listed at the bottom.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <Card>
        <CardContent>
          {loading && rows.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
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
              className="border-0 bg-transparent shadow-none ring-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Startup</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead aria-sort={direction === "asc" ? "ascending" : "descending"}>
                    <button
                      type="button"
                      onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
                      className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Health Score
                      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">
                        {direction === "asc" ? "(lowest first, click for highest first)" : "(highest first, click for lowest first)"}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row, i) => {
                  const key = rowKey(row, i);
                  const open = expanded === key;
                  const panelId = `cohort-row-${i}`;
                  const label = row.email || row.domain || "this startup";
                  return (
                    <Fragment key={key}>
                      <TableRow
                        onClick={() => toggle(key)}
                        className="cursor-pointer"
                        data-state={open ? "selected" : undefined}
                      >
                        <TableCell className="max-w-[16rem]">
                          <span className="block truncate font-medium">{row.email || "—"}</span>
                          {row.domain && (
                            <span className="block truncate text-xs text-muted-foreground">{row.domain}</span>
                          )}
                        </TableCell>
                        <TableCell className="capitalize">{row.stage || "—"}</TableCell>
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
                        <TableCell className="text-right tabular-nums">
                          {typeof row.meeting_count === "number" ? row.meeting_count : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateLabel(row.last_activity)}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(key);
                            }}
                            aria-expanded={open}
                            aria-controls={open ? panelId : undefined}
                            aria-label={`${open ? "Hide" : "Show"} health history for ${label}`}
                            className="inline-flex rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <ChevronDown
                              className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                              aria-hidden="true"
                            />
                          </button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30">
                            <div id={panelId} className="space-y-2 px-1 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>Health history (last {Math.min(10, row.health_history?.length || 0)} entries)</span>
                                <span>
                                  {typeof row.match_count === "number" ? `${row.match_count} matches · ` : ""}
                                  {typeof row.meeting_count === "number" ? `${row.meeting_count} meetings` : ""}
                                </span>
                              </div>
                              <Sparkline
                                history={row.health_history}
                                limit={10}
                                height={64}
                                label={`Health history for ${label}`}
                              />
                            </div>
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
