"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Card from "@/components/Card";
import Badge from "@/components/Badge";
import Spinner from "@/components/Spinner";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("mentora_profile");
      if (raw) {
        setProfile(JSON.parse(raw));
      }
    } catch (err) {
      setProfile(null);
    } finally {
      setHydrated(true);
    }
  }, []);

  async function handleFindMentors() {
    if (!profile) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("http://localhost:8000/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const data = await res.json();
      const matches = Array.isArray(data) ? data : data.matches || [];
      window.localStorage.setItem("mentora_matches", JSON.stringify(matches));
      router.push("/matches");
    } catch (err) {
      setError(
        "Something went wrong finding your mentors. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!hydrated) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Spinner className="h-6 w-6 text-navy-100/60" />
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
            <h1 className="text-xl font-bold text-white mb-3">
              No startup profile found
            </h1>
            <p className="text-navy-100/70 mb-6">
              Upload a pitch deck first so we can build your startup
              profile.
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-accent-light transition-colors"
            >
              Go to Upload
            </Link>
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
            <h1 className="text-3xl font-extrabold text-white mb-3">
              Your Startup Profile
            </h1>
            <p className="text-navy-100/70">
              Here&apos;s what we extracted from your pitch deck.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-6">
            <Card>
              <h2 className="text-xs uppercase tracking-wide text-navy-100/50 mb-2">
                Domain
              </h2>
              <p className="text-2xl font-bold text-white">
                {domain || "Unknown"}
              </p>
            </Card>
            <Card>
              <h2 className="text-xs uppercase tracking-wide text-navy-100/50 mb-3">
                Stage
              </h2>
              <Badge>{stage || "Unknown"}</Badge>
            </Card>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            <Card>
              <h2 className="text-xs uppercase tracking-wide text-navy-100/50 mb-4">
                Challenges
              </h2>
              {challenges.length ? (
                <div className="flex flex-wrap gap-2">
                  {challenges.map((c, i) => (
                    <Badge key={i} tone="accent">
                      {c}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-navy-100/50">None identified.</p>
              )}
            </Card>
            <Card>
              <h2 className="text-xs uppercase tracking-wide text-navy-100/50 mb-4">
                Team Gaps
              </h2>
              {team_gaps.length ? (
                <div className="flex flex-wrap gap-2">
                  {team_gaps.map((g, i) => (
                    <Badge key={i} tone="accent">
                      {g}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-navy-100/50">None identified.</p>
              )}
            </Card>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300 text-center">
              {error}
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={handleFindMentors}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-3.5 text-base font-semibold text-navy-900 shadow-soft hover:bg-accent-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && <Spinner />}
              {loading ? "Finding mentors..." : "Find Mentors"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
