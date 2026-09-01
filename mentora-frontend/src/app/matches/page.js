"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Copy } from "lucide-react";
import { sendEmail } from "@/lib/api";

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "");
  return initials.join("") || "?";
}

function EmailDialog({ open, onOpenChange, mentor, startupProfile }) {
  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !mentor) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSubject("");
    setBody("");

    sendEmail(startupProfile, mentor)
      .then((data) => {
        if (cancelled) return;
        setSubject(data?.subject || `Introduction request for ${mentor.name || "you"}`);
        setBody(data?.body || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not generate the intro email.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mentor, startupProfile]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  function handleSend() {
    // Stub: no real email server exists yet, so we hand off to the user's
    // mail client via a mailto: link pre-filled with the drafted content.
    const to = mentor?.email || "";
    const params = new URLSearchParams({
      subject,
      body,
    });
    window.location.href = `mailto:${to}?${params.toString()}`;
    toast.success("Opening your mail client (stub: no live email backend yet).");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send intro email</DialogTitle>
          <DialogDescription>
            Drafted for {mentor?.name || "this mentor"}. Feel free to edit
            before sending.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-body">Body</Label>
              <Textarea
                id="email-body"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            disabled={loading || !!error}
          >
            <Copy className="h-4 w-4" />
            Copy
          </Button>
          <Button type="button" onClick={handleSend} disabled={loading || !!error}>
            <Mail className="h-4 w-4" />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MatchesPage() {
  const [matches, setMatches] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [startupProfile, setStartupProfile] = useState(null);
  const [activeMentor, setActiveMentor] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    try {
      const rawMatches = window.localStorage.getItem("mentorMatches");
      if (rawMatches) {
        const parsed = JSON.parse(rawMatches);
        setMatches(Array.isArray(parsed) ? parsed : parsed.matches || []);
      }
      const rawProfile = window.localStorage.getItem("startupProfile");
      if (rawProfile) setStartupProfile(JSON.parse(rawProfile));
    } catch {
      setMatches(null);
    } finally {
      setHydrated(true);
    }
  }, []);

  function openEmailDialog(mentor) {
    setActiveMentor(mentor);
    setDialogOpen(true);
  }

  if (!hydrated) {
    return (
      <>
        <Navbar />
        <main className="flex-1 px-6 py-16">
          <div className="max-w-3xl mx-auto space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </main>
      </>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Card className="max-w-md w-full text-center">
            <CardContent className="py-2">
              <h1 className="text-xl font-bold text-foreground mb-3">
                No mentor matches found
              </h1>
              <p className="text-muted-foreground mb-6">
                Upload a pitch deck to get matched with mentors suited to your
                startup.
              </p>
              <Button render={<Link href="/upload" />}>Go to Upload</Button>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  const topMatches = matches.slice(0, 5);

  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Your Top Mentor Matches
            </h1>
            <p className="text-muted-foreground">
              Based on your startup profile, here are the mentors best suited
              to help you.
            </p>
          </div>

          <div className="grid gap-6">
            {topMatches.map((mentor, i) => {
              const rawScore =
                typeof mentor.match_score === "number" ? mentor.match_score : 0;
              const percent = Math.round(
                Math.max(0, Math.min(100, rawScore <= 1 ? rawScore * 100 : rawScore))
              );

              return (
                <Card key={i}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Avatar size="lg">
                          <AvatarFallback>
                            {initialsFor(mentor.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="text-lg">
                            {mentor.name || "Unnamed mentor"}
                          </CardTitle>
                          <Badge variant="secondary" className="mt-1">
                            {mentor.domain || "General"}
                          </Badge>
                        </div>
                      </div>
                      <span className="inline-flex items-center justify-center bg-muted h-8 w-8 text-sm font-semibold text-muted-foreground">
                        #{i + 1}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {Array.isArray(mentor.expertise) &&
                      mentor.expertise.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-5">
                          {mentor.expertise.map((skill, idx) => (
                            <Badge key={idx} variant="outline">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      )}

                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        Match score
                      </span>
                      <span className="text-sm font-semibold text-primary">
                        {percent}%
                      </span>
                    </div>
                    <Progress value={percent} />

                    <div className="mt-5 flex justify-end">
                      <Button type="button" onClick={() => openEmailDialog(mentor)}>
                        <Mail className="h-4 w-4" />
                        Send Intro Email
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </main>

      <EmailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mentor={activeMentor}
        startupProfile={startupProfile}
      />
    </>
  );
}
