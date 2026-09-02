import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { UploadCloud, Sparkles, Send } from "lucide-react";

const FEATURES = [
  {
    icon: UploadCloud,
    title: "Ingest",
    description: "Upload a pitch deck, we extract the startup profile.",
  },
  {
    icon: Sparkles,
    title: "Match",
    description: "Vector search finds mentors whose expertise fits.",
  },
  {
    icon: Send,
    title: "Act",
    description: "Send intro emails and track outcomes.",
  },
];

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 flex flex-col">
        <section className="flex-1 flex items-center justify-center px-4 sm:px-6 py-20 sm:py-24 border-b border-border">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground mb-6">
              Find the right mentor. Automatically.
            </h1>
            <p className="text-base sm:text-xl text-muted-foreground mb-10 leading-relaxed">
              Upload a pitch deck and Mentora extracts your startup profile,
              matches you with mentors whose expertise fits, and drafts the
              intro email — all in a few minutes.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<Link href="/upload" />}>
                Get Matched
              </Button>
              <Button size="lg" variant="outline" render={<Link href="/login" />}>
                Sign In
              </Button>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 py-16 sm:py-20">
          <div className="max-w-5xl mx-auto grid gap-6 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title}>
                <CardHeader>
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
