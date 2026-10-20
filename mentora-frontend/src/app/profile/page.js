"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileUp,
  Pencil,
  Globe2,
  Layers,
  Lightbulb,
  Loader2,
  MapPin,
  Target,
  Users,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import ScoreRing from "@/components/ui/ScoreRing";
import { Stagger, HoverCard, FadeIn } from "@/components/motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { StateCard, InlineError } from "@/components/StateCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useStartupJourney } from "@/hooks/use-startup-journey";
import { matchMentors, updateActiveProfile, updateStartup } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_CONFIDENCE = 75;
const MAX_LIST_ITEMS = 4;

/** Backend stage values are "idea" | "MVP" | "growth"; match case-insensitively. */
const STAGE_STYLES = {
  idea: { label: "Idea", className: "border-blue-500/30 bg-blue-500/15 text-blue-300" },
  mvp: { label: "MVP", className: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  growth: { label: "Growth", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
};

function StageBadge({ stage }) {
  const style = STAGE_STYLES[String(stage || "").toLowerCase()];
  return (
    <Badge variant="outline" className={cn("h-6 px-2.5 text-sm", style?.className)}>
      {style?.label || stage || "Unknown"}
    </Badge>
  );
}

function FieldCard({ icon: Icon, label, children }) {
  return (
    <HoverCard>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </HoverCard>
  );
}

function BulletList({ items, emptyLabel }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const shown = items.slice(0, MAX_LIST_ITEMS);
  const extra = items.length - shown.length;
  return (
    <>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground marker:text-primary">
        {shown.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>
      {extra > 0 && <p className="mt-2 text-xs text-muted-foreground">+{extra} more</p>}
    </>
  );
}

function SignalList({ items, tone }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const Icon = tone === "strong" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tone === "strong" ? "Strong signals" : "Weak signals"}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                tone === "strong" ? "text-emerald-400" : "text-amber-400"
              )}
              aria-hidden="true"
            />
            <span className="break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function ConfidenceCard({ feedback }) {
  const hasFeedback = Boolean(feedback && typeof feedback === "object");
  const score = hasFeedback ? clampScore(feedback.confidence_score) : DEFAULT_CONFIDENCE;
  const tips = hasFeedback && Array.isArray(feedback.improvement_tips) ? feedback.improvement_tips : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Match Confidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <ScoreRing
            value={score}
            size={88}
            stroke={7}
            thresholds="confidence"
            label={`Match confidence ${score} out of 100`}
          >
            <span className="text-xl font-bold tabular-nums">{score}</span>
          </ScoreRing>
          <p className="text-sm text-muted-foreground">
            {hasFeedback
              ? "How well a mentor can judge fit from what your deck tells us."
              : "Estimated from your profile. Re-upload your deck for detailed feedback."}
          </p>
        </div>

        {hasFeedback && (
          <>
            <SignalList items={feedback.strong_signals} tone="strong" />
            <SignalList items={feedback.weak_signals} tone="weak" />
          </>
        )}

        {tips.length > 0 && (
          <Accordion>
            <AccordionItem value="tips">
              <AccordionTrigger>How to improve</AccordionTrigger>
              <AccordionContent>
                <ol className="space-y-2">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                      <span>
                        <span className="mr-1 font-semibold tabular-nums">{i + 1}.</span>
                        {tip}
                      </span>
                    </li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function FieldCardsSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="py-2">
            <Skeleton className="mb-4 h-4 w-24" />
            <Skeleton className="mb-2 h-6 w-40" />
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const STAGES = [
  { value: "idea", label: "Idea" },
  { value: "MVP", label: "MVP" },
  { value: "growth", label: "Growth" },
];

function linesOf(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Correct the extracted fields; saving creates a new profile version. */
function ProfileEditor({ profile, onCancel, onSaved }) {
  const [domain, setDomain] = useState(profile.domain || "");
  const [stage, setStage] = useState(profile.stage || "MVP");
  const [geography, setGeography] = useState(profile.geography || "");
  const [challenges, setChallenges] = useState((profile.challenges || []).join("\n"));
  const [teamGaps, setTeamGaps] = useState((profile.team_gaps || []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    if (!domain.trim()) {
      setError("Domain can't be empty.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const me = await updateActiveProfile({
        domain: domain.trim(),
        stage,
        geography: geography.trim() || null,
        challenges: linesOf(challenges),
        team_gaps: linesOf(teamGaps),
      });
      toast.success(`Profile saved as version ${me?.active_profile?.version ?? ""}`.trim());
      onSaved(me);
    } catch (err) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Correct your profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-domain">Domain</Label>
              <Input id="profile-domain" value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-geography">Geography</Label>
              <Input
                id="profile-geography"
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="e.g. Bangalore"
                maxLength={120}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span id="profile-stage-label" className="text-sm font-medium">
              Stage
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[stage]}
              onValueChange={(next) => {
                const picked = next.find((v) => v !== stage) ?? next[0];
                if (picked) setStage(picked);
              }}
              aria-labelledby="profile-stage-label"
            >
              {STAGES.map((s) => (
                <ToggleGroupItem
                  key={s.value}
                  value={s.value}
                  className="px-3 aria-pressed:border-primary/50 aria-pressed:bg-primary/15 aria-pressed:text-primary"
                >
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-challenges">Challenges (one per line)</Label>
              <Textarea
                id="profile-challenges"
                rows={5}
                value={challenges}
                onChange={(e) => setChallenges(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-gaps">Team gaps (one per line)</Label>
              <Textarea id="profile-gaps" rows={5} value={teamGaps} onChange={(e) => setTeamGaps(e.target.value)} />
            </div>
          </div>
          {error && <InlineError message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              {saving ? "Saving…" : "Save new version"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CompanyName({ startup, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const current = startup?.company_name || "";

  async function handleSave(e) {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    try {
      onSaved(await updateStartup({ company_name: value.trim() }));
      setEditing(false);
      toast.success("Company name saved");
    } catch (err) {
      if (err.status !== 0) toast.error(err.message || "Could not save the company name.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className={current ? "font-semibold" : "text-muted-foreground"}>{current || "No company name yet"}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue(current);
            setEditing(true);
          }}
          disabled={!startup}
        >
          <Pencil aria-hidden="true" />
          {current ? "Rename" : "Add company name"}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={handleSave} className="mb-6 flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="company-name">Company name</Label>
        <Input
          id="company-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          className="w-64"
          autoFocus
        />
      </div>
      <Button type="submit" size="sm" disabled={saving || !value.trim()}>
        {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
        Cancel
      </Button>
    </form>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const { startup, profile, loaded, error, reload, applyStartup } = useStartupJourney({ withMatches: false });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  async function handleFindMentors() {
    if (!profile || loading) return;
    setLoading(true);
    try {
      // Empty body: the backend matches on the active server-side profile.
      await matchMentors();
      router.push("/matches");
    } catch (err) {
      // Network failures already raised the "Server unavailable" toast.
      if (err.status !== 0) {
        toast.error(err.message || "Something went wrong finding your mentors.");
      }
      setLoading(false);
    }
  }

  if (!profile && loaded) {
    return (
      <PageWrapper key="empty" className="max-w-lg">
        {error ? (
          <InlineError message={error}>
            <Button type="button" size="sm" variant="outline" onClick={reload}>
              Try again
            </Button>
          </InlineError>
        ) : (
          <StateCard
            icon={FileUp}
            title="No profile yet"
            description="Upload your pitch deck and we'll extract your startup profile from it."
            actions={<Button render={<Link href="/upload" />}>Upload a pitch deck</Button>}
          />
        )}
      </PageWrapper>
    );
  }

  // First load (no cached profile yet).
  if (!profile) {
    return (
      <PageWrapper key="loading">
        <div className="grid gap-8 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-5 w-full max-w-md" />
            <FieldCardsSkeleton />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  const { domain, stage, challenges, team_gaps: teamGaps, geography, deck_feedback: feedback } = profile;
  const hasFeedback = Boolean(feedback && typeof feedback === "object");
  const score = hasFeedback ? clampScore(feedback.confidence_score) : DEFAULT_CONFIDENCE;

  return (
    <PageWrapper>
      <div className="grid gap-8 lg:grid-cols-5">
        {/* Left — extracted profile (60%) */}
        <div className="min-w-0 lg:col-span-3">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Here&apos;s what we understood</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review your profile before we find your matches.
                {profile.version ? ` Version ${profile.version}` : ""}
                {profile.deck_filename ? ` · ${profile.deck_filename}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              {!editing && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" render={<Link href="/upload" />}>
                Re-upload
              </Button>
            </div>
          </div>

          <CompanyName startup={startup} onSaved={applyStartup} />

          {editing ? (
            <ProfileEditor
              profile={profile}
              onCancel={() => setEditing(false)}
              onSaved={(me) => {
                applyStartup(me);
                setEditing(false);
              }}
            />
          ) : loading ? (
            <FieldCardsSkeleton />
          ) : (
            <Stagger className="grid gap-5 sm:grid-cols-2" stagger={0.08}>
              <FieldCard icon={Globe2} label="Domain">
                <p className="break-words text-xl font-bold text-foreground">{domain || "Unknown"}</p>
              </FieldCard>

              <FieldCard icon={Layers} label="Stage">
                <div className="flex flex-wrap items-center gap-3">
                  <StageBadge stage={stage} />
                  {geography && (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {geography}
                    </span>
                  )}
                </div>
              </FieldCard>

              <FieldCard icon={Target} label="Challenges">
                <BulletList items={challenges} emptyLabel="None identified in your deck." />
              </FieldCard>

              <FieldCard icon={Users} label="Team Gaps">
                <BulletList items={teamGaps} emptyLabel="None identified in your deck." />
              </FieldCard>
            </Stagger>
          )}
        </div>

        {/* Right — sticky confidence sidebar (40%) */}
        <aside className="min-w-0 lg:col-span-2" aria-label="Match confidence">
          <div className="lg:sticky lg:top-24">
            <ConfidenceCard feedback={hasFeedback ? feedback : null} />
          </div>
        </aside>
      </div>

      <Stagger className="mt-8 space-y-4">
        {hasFeedback && score < 50 && (
          <FadeIn
            role="status"
            className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex items-start gap-2 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              Limited deck detail — matches may be less accurate
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" render={<Link href="/upload" />}>
                Re-upload
              </Button>
              <Button size="sm" onClick={handleFindMentors} disabled={loading || editing}>
                Continue Anyway →
              </Button>
            </div>
          </FadeIn>
        )}
        {hasFeedback && score >= 80 && (
          <FadeIn
            role="status"
            className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Great detail — your matches will be highly targeted
          </FadeIn>
        )}

        <FadeIn>
          <Button
            type="button"
            onClick={handleFindMentors}
            disabled={loading || editing}
            size="lg"
            className="h-11 w-full text-base"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? "Finding your mentors…" : "Find My Mentors →"}
          </Button>
        </FadeIn>
        <p aria-live="polite" className="sr-only">
          {loading ? "Finding your mentor matches" : ""}
        </p>
      </Stagger>
    </PageWrapper>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard requiredRole="startup">
      <ProfilePageContent />
    </AuthGuard>
  );
}
