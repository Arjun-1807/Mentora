"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { matchMentors } from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("startupProfile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {
      setProfile(null);
    } finally {
      setHydrated(true);
    }
  }, []);

  async function handleFindMentors() {
    if (!profile) return;
    setLoading(true);
    try {
      const data = await matchMentors(profile);
      window.localStorage.setItem("mentorMatches", JSON.stringify(data));
      router.push("/matches");
    } catch (err) {
      toast.error(err.message || "Something went wrong finding your mentors.");
    } finally {
      setLoading(false);
    }
  }

  if (!hydrated) {
    return (
      <>
        <Navbar />
        <main className="flex-1 px-6 py-16">
          <div className="max-w-3xl mx-auto">
            <div className="mb-10 text-center">
              <Skeleton className="h-9 w-72 mx-auto mb-3" />
              <Skeleton className="h-5 w-96 mx-auto" />
            </div>
            <div className="grid sm:grid-cols-2 gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="py-2">
                    <Skeleton className="h-4 w-24 mb-4" />
                    <Skeleton className="h-6 w-40" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Card className="max-w-md w-full text-center">
            <CardContent className="py-2">
              <h1 className="text-xl font-bold text-foreground mb-3">
                No startup profile found
              </h1>
              <p className="text-muted-foreground mb-6">
                Upload a pitch deck first so we can build your startup
                profile.
              </p>
              <Button render={<Link href="/upload" />}>Go to Upload</Button>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  const { domain, stage, challenges = [], team_gaps = [] } = profile;

  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Your Startup Profile
            </h1>
            <p className="text-muted-foreground">
              Here&apos;s what we extracted from your pitch deck.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  Domain
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">
                  {domain || "Unknown"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  Stage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge>{stage || "Unknown"}</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  Challenges
                </CardTitle>
              </CardHeader>
              <CardContent>
                {challenges.length ? (
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {challenges.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    None identified.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  Team Gaps
                </CardTitle>
              </CardHeader>
              <CardContent>
                {team_gaps.length ? (
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {team_gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    None identified.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="text-center">
            <Button
              type="button"
              onClick={handleFindMentors}
              disabled={loading}
              size="lg"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Finding mentors..." : "Find My Mentors"}
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
