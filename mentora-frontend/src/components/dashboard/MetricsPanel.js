"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Crosshair, Gauge, Info, ListOrdered, Loader2, Search, Sigma } from "lucide-react";
import { toast } from "sonner";
import StatCard from "@/components/ui/StatCard";
import { InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { runEvaluation } from "@/lib/api";
import { getStoredProfile } from "@/lib/storage";
import { parseEvaluationInput } from "@/lib/validation";

// recharts is heavy and only needed once results exist, so load it lazily.
const MetricsChart = dynamic(() => import("@/components/MetricsChart"), {
  ssr: false,
  loading: () => <Skeleton className="mt-6 h-64 w-full" />,
});

const METRICS = [
  {
    key: "precision_at_5",
    label: "Precision@5",
    icon: Crosshair,
    help: "Of the 5 mentors Mentora returned, the share that are on your ground-truth list.",
  },
  {
    key: "recall_at_5",
    label: "Recall@5",
    icon: Search,
    help: "Of all the mentors you marked as right, the share that made it into the top 5.",
  },
  {
    key: "mrr",
    label: "MRR",
    icon: ListOrdered,
    help: "How high the first correct mentor ranks: 1.0 means it was #1, 0.5 means #2, 0 means none made the top 5.",
  },
  {
    key: "ndcg_at_5",
    label: "NDCG@5",
    icon: Sigma,
    help: "Rewards putting the correct mentors near the top of the list. 1.0 is a perfect ordering.",
  },
  {
    key: "avg_match_score",
    label: "Avg Score",
    icon: Gauge,
    help: "Average embedding similarity (cosine, 0–1) between the profile and the top 5 mentors.",
  },
];

const EXAMPLE_PROFILE = {
  domain: "FinTech",
  stage: "MVP",
  challenges: ["Customer acquisition", "Regulatory compliance"],
  team_gaps: ["No CTO"],
  geography: "Bangalore",
};

function MetricLabel({ label, help }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`What is ${label}?`}
            />
          }
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="block max-w-60 text-left">{help}</TooltipContent>
      </Tooltip>
    </span>
  );
}

/**
 * Collapsible retrieval-evaluation panel (POST /evaluate): paste a profile +
 * ground-truth mentor ids, get Precision@5 / Recall@5 / MRR / NDCG@5 / Avg
 * Score as StatCards plus a bar chart. Same logic as RetrievalMetrics, in the
 * dashboard's StatCard style.
 */
export default function MetricsPanel() {
  const panelId = useId();
  const [open, setOpen] = useState(true);
  const [profileJson, setProfileJson] = useState("");
  const [idsText, setIdsText] = useState("");
  const [errors, setErrors] = useState({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [results, setResults] = useState(null);

  // Start from the user's own extracted profile when there is one.
  useEffect(() => {
    setProfileJson(JSON.stringify(getStoredProfile() || EXAMPLE_PROFILE, null, 2));
  }, []);

  async function handleRun(e) {
    e.preventDefault();
    if (running) return;
    const { profile, ids, errors: inputErrors } = parseEvaluationInput(profileJson, idsText);
    setErrors(inputErrors);
    if (Object.keys(inputErrors).length > 0) return;

    setRunning(true);
    setRunError("");
    try {
      setResults(await runEvaluation(profile, ids));
    } catch (err) {
      setRunError(err.message || "Could not run the evaluation.");
      if (err.status !== 0) toast.error("Evaluation failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex w-full items-center justify-between gap-4 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span>
              <CardTitle>Run an evaluation</CardTitle>
              <CardDescription className="mt-1">
                Check how well matching ranks the mentors you know are right for a profile.
              </CardDescription>
            </span>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </CardHeader>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              key="panel"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <CardContent>
                <form onSubmit={handleRun} noValidate className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="eval-profile">Startup profile (JSON)</Label>
                    <Textarea
                      id="eval-profile"
                      rows={8}
                      spellCheck={false}
                      className="font-mono text-xs"
                      value={profileJson}
                      onChange={(e) => setProfileJson(e.target.value)}
                      aria-invalid={Boolean(errors.profile) || undefined}
                      aria-describedby={errors.profile ? "eval-profile-error" : undefined}
                    />
                    {errors.profile && (
                      <p id="eval-profile-error" role="alert" className="text-xs text-destructive">
                        {errors.profile}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="eval-ids">Ground-truth mentor IDs</Label>
                    <Input
                      id="eval-ids"
                      placeholder="e.g. 66f1c0…, 66f1c1…"
                      value={idsText}
                      onChange={(e) => setIdsText(e.target.value)}
                      aria-invalid={Boolean(errors.ids) || undefined}
                      aria-describedby={errors.ids ? "eval-ids-error" : "eval-ids-hint"}
                    />
                    {errors.ids ? (
                      <p id="eval-ids-error" role="alert" className="text-xs text-destructive">
                        {errors.ids}
                      </p>
                    ) : (
                      <p id="eval-ids-hint" className="text-xs text-muted-foreground">
                        Comma-separated mentor IDs you consider correct matches for this profile.
                      </p>
                    )}
                  </div>

                  {runError && <InlineError message={runError} />}

                  <Button type="submit" disabled={running}>
                    {running && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {running ? "Evaluating…" : "Run Evaluation"}
                  </Button>
                </form>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {results && (
        <section aria-live="polite" aria-label="Evaluation results" className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {METRICS.map((m) => {
              const Icon = m.icon;
              return (
                <StatCard
                  key={m.key}
                  icon={<Icon />}
                  label={<MetricLabel label={m.label} help={m.help} />}
                  // Fixed 3 decimals so the five cards line up.
                  value={Number(results[m.key] ?? 0).toFixed(3)}
                />
              );
            })}
          </div>
          <Card>
            <CardContent>
              <MetricsChart
                data={METRICS.map((m) => ({ metric: m.label, value: Number(results[m.key] ?? 0) }))}
              />
              {Array.isArray(results.top_5_mentor_ids) && results.top_5_mentor_ids.length > 0 && (
                <p className="mt-4 break-all text-xs text-muted-foreground">
                  Top 5 returned: <span className="font-mono">{results.top_5_mentor_ids.join(", ")}</span>
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
