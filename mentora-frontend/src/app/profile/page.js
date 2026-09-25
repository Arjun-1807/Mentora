"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { InlineError } from "@/components/StateCard";
import { FadeIn, HoverCard } from "@/components/motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, MapPin } from "lucide-react";
import { matchMentors } from "@/lib/api";
import { getStoredProfile, setStoredMatches } from "@/lib/storage";

function FieldCard({ label, children }) {
  return (
    <HoverCard>
      <Card>
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
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
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
      {items.map((item, i) => (
        <li key={i} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // getStoredProfile() returns null for a missing *or* malformed profile;
    // either way there's nothing to review, so send the user back to upload.
    const stored = getStoredProfile();
    if (!stored) {
      toast.info("Please upload your pitch deck first.", { id: "profile-missing" });
      router.replace("/upload");
      return;
    }
    setProfile(stored);
  }, [router]);

  async function handleFindMentors() {
    if (!profile || loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await matchMentors(profile);
      const matches = Array.isArray(data) ? data : data?.matches || [];
      setStoredMatches(matches);
      router.push("/matches");
    } catch (err) {
      setError(err.message || "Something went wrong finding your mentors.");
    } finally {
      setLoading(false);
    }
  }

  // Hydrating (or redirecting away). Keyed separately so the real page gets a
  // fresh Stagger and plays its entrance when it replaces the skeleton.
  if (!profile) {
    return (
      <PageShell key="loading">
        <div className="mb-10 text-center">
          <Skeleton className="h-9 w-72 mx-auto mb-3" />
          <Skeleton className="h-5 w-full max-w-md mx-auto" />
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-6 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    );
  }

  const { domain, stage, challenges, team_gaps: teamGaps, geography } = profile;

  return (
    <PageShell>
      <PageHeader
        align="center"
        title="Here's what Mentora understood"
        description="Review your extracted profile before we find your matches."
      />

      <div className="grid gap-5 sm:grid-cols-2 mb-8">
        <FieldCard label="Domain">
          <p className="text-2xl font-bold text-foreground break-words">
            {domain || "Unknown"}
          </p>
        </FieldCard>

        <FieldCard label="Stage">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{stage || "Unknown"}</Badge>
            {geography && (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {geography}
              </span>
            )}
          </div>
        </FieldCard>

        <FieldCard label="Challenges">
          <BulletList items={challenges} emptyLabel="None identified in your deck." />
        </FieldCard>

        <FieldCard label="Team gaps">
          <BulletList items={teamGaps} emptyLabel="None identified in your deck." />
        </FieldCard>
      </div>

      {error && (
        <InlineError message={error} className="mb-6">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleFindMentors}
            disabled={loading}
          >
            Try again
          </Button>
        </InlineError>
      )}

      <FadeIn className="flex flex-col items-center gap-3">
        <Button type="button" onClick={handleFindMentors} disabled={loading} size="lg">
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? "Finding mentors…" : "Find My Mentors →"}
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/upload" />}>
          Upload a different deck
        </Button>
        <p aria-live="polite" className="sr-only">
          {loading ? "Finding your mentor matches" : ""}
        </p>
      </FadeIn>
    </PageShell>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfilePageContent />
    </AuthGuard>
  );
}
