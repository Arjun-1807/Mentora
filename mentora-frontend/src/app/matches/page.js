"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Card from "@/components/Card";
import Badge from "@/components/Badge";
import ScoreBar from "@/components/ScoreBar";
import Spinner from "@/components/Spinner";

export default function MatchesPage() {
  const [matches, setMatches] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("mentora_matches");
      if (raw) {
        const parsed = JSON.parse(raw);
        setMatches(Array.isArray(parsed) ? parsed : parsed.matches || []);
      }
    } catch (err) {
      setMatches(null);
    } finally {
      setHydrated(true);
    }
  }, []);

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

  if (!matches || matches.length === 0) {
    return (
      <>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Card className="max-w-md w-full text-center">
            <h1 className="text-xl font-bold text-white mb-3">
              No mentor matches found
            </h1>
            <p className="text-navy-100/70 mb-6">
              Upload a pitch deck to get matched with mentors suited to your
              startup.
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

  const topMatches = matches.slice(0, 5);

  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-extrabold text-white mb-3">
              Your Top Mentor Matches
            </h1>
            <p className="text-navy-100/70">
              Based on your startup profile, here are the mentors best suited
              to help you.
            </p>
          </div>

          <div className="grid gap-6">
            {topMatches.map((mentor, i) => (
              <Card key={i}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">
                      {mentor.name || "Unnamed mentor"}
                    </h2>
                    <p className="text-sm text-navy-100/60">
                      {mentor.domain || "General"}
                    </p>
                  </div>
                  <span className="inline-flex items-center justify-center rounded-full bg-white/10 h-8 w-8 text-sm font-semibold text-navy-100/70">
                    #{i + 1}
                  </span>
                </div>

                {Array.isArray(mentor.expertise) &&
                  mentor.expertise.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-5">
                      {mentor.expertise.map((skill, idx) => (
                        <Badge key={idx}>{skill}</Badge>
                      ))}
                    </div>
                  )}

                <ScoreBar score={mentor.match_score} />

                <div className="mt-5 flex justify-end">
                  <span
                    title="Coming soon"
                    className="inline-block"
                  >
                    <button
                      type="button"
                      disabled
                      className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white/40 cursor-not-allowed"
                    >
                      Send Intro Email
                    </button>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
