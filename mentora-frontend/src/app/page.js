import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { AnimatedWords, FadeIn, HoverCard, Stagger } from "@/components/motion";
import { UploadCloud, Sparkles, ListOrdered } from "lucide-react";

const FEATURES = [
  {
    icon: UploadCloud,
    title: "Upload your deck",
    description: "Drop in your pitch deck as a PDF. No forms, no questionnaires.",
  },
  {
    icon: Sparkles,
    title: "AI extracts your profile",
    description:
      "Mentora reads your deck and pulls out your domain, stage, challenges and team gaps.",
  },
  {
    icon: ListOrdered,
    title: "Get ranked mentor matches",
    description:
      "See the mentors best placed to help, ranked by fit, with a personalised intro ready to send.",
  },
];

const PROOF = ["Built for college incubators", "Karnataka Startup Cell", "DSCE Innovation Lab"];

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      <section className="relative isolate flex-1 flex items-center justify-center px-4 sm:px-6 py-20 sm:py-24 border-b border-border">
        <div className="hero-grid -z-10" aria-hidden="true" />
        <div className="max-w-2xl w-full text-center">
          <AnimatedWords
            text="Find the right mentor. Automatically."
            className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground mb-6"
          />
          <Stagger delay={0.3}>
            <FadeIn
              as="p"
              className="text-base sm:text-xl text-muted-foreground mb-10 leading-relaxed"
            >
              Mentora uses AI to match startups with domain-expert mentors — from
              pitch deck to personalised intro, in seconds.
            </FadeIn>
            <FadeIn className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<Link href="/upload" />}>
                Get Matched
              </Button>
              <Button size="lg" variant="outline" render={<Link href="/login" />}>
                Sign In
              </Button>
            </FadeIn>
          </Stagger>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-16 sm:py-20">
        <Stagger className="max-w-5xl mx-auto grid gap-6 sm:grid-cols-3" delay={0.6}>
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <HoverCard key={title}>
              <Card>
                <CardHeader>
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </HoverCard>
          ))}
        </Stagger>

        <Stagger delay={0.9}>
          <FadeIn
            as="p"
            className="mt-12 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs sm:text-sm text-muted-foreground"
          >
            {PROOF.map((item, i) => (
              <span key={item} className="inline-flex items-center gap-3">
                {i > 0 && <span aria-hidden="true">·</span>}
                {item}
              </span>
            ))}
          </FadeIn>
        </Stagger>
      </section>
    </main>
  );
}
