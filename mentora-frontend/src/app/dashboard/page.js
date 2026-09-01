"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Star, Loader2 } from "lucide-react";
import { getAllMatches, logFeedback } from "@/lib/api";

const STATUS_VARIANT = {
  pending: "secondary",
  sent: "outline",
  accepted: "default",
  declined: "destructive",
  completed: "default",
};

function StarRating({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="p-0.5"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            className={`h-5 w-5 ${
              n <= value ? "fill-primary text-primary" : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function LogOutcomeDialog({ open, onOpenChange, match, onSubmitted }) {
  const [attended, setAttended] = useState(false);
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAttended(false);
      setRating(0);
    }
  }, [open]);

  async function handleSubmit() {
    if (!match) return;
    setSubmitting(true);
    try {
      const result = await logFeedback({
        match_id: match.match_id,
        mentor_id: match.mentor_id,
        attended,
        rating,
      });
      toast.success("Outcome logged.");
      onSubmitted?.(match, result);
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message || "Could not log this outcome.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log outcome</DialogTitle>
          <DialogDescription>
            Record what happened with this match.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="attended-switch">Meeting attended</Label>
            <Switch
              id="attended-switch"
              checked={attended}
              onCheckedChange={setAttended}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Satisfaction rating</Label>
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeMatch, setActiveMatch] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAllMatches()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.matches || [];
        setMatches(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load matches.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openLogDialog(match) {
    setActiveMatch(match);
    setDialogOpen(true);
  }

  const totalMatches = matches.length;
  const emailsSent = matches.filter((m) =>
    ["sent", "accepted", "declined", "completed"].includes((m.status || "").toLowerCase())
  ).length;
  const meetingsAccepted = matches.filter(
    (m) => (m.status || "").toLowerCase() === "accepted"
  ).length;
  const ratings = matches
    .map((m) => m.rating)
    .filter((r) => typeof r === "number" && !Number.isNaN(r));
  const avgSatisfaction = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : "—";

  const stats = [
    { label: "Total Matches", value: totalMatches },
    { label: "Emails Sent", value: emailsSent },
    { label: "Meetings Accepted", value: meetingsAccepted },
    { label: "Avg Satisfaction", value: avgSatisfaction },
  ];

  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Dashboard
            </h1>
            <p className="text-muted-foreground">
              Track match outcomes across all your startups and mentors.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-10">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardHeader>
                  <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <p className="text-3xl font-bold text-foreground">
                      {stat.value}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>All matches</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matches recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match ID</TableHead>
                      <TableHead>Mentor</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.map((match) => {
                      const status = (match.status || "pending").toLowerCase();
                      return (
                        <TableRow key={match.match_id}>
                          <TableCell className="font-mono text-xs">
                            {match.match_id}
                          </TableCell>
                          <TableCell>{match.mentor_id}</TableCell>
                          <TableCell>
                            {typeof match.score === "number"
                              ? `${Math.round(
                                  match.score <= 1 ? match.score * 100 : match.score
                                )}%`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[status] || "secondary"}>
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {match.timestamp
                              ? new Date(match.timestamp).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openLogDialog(match)}
                            >
                              Log Outcome
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <LogOutcomeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        match={activeMatch}
        onSubmitted={(match, result) => {
          setMatches((prev) =>
            prev.map((m) =>
              m.match_id === match.match_id
                ? { ...m, status: "completed", rating: result?.new_effectiveness_score ?? m.rating }
                : m
            )
          );
        }}
      />
    </>
  );
}
