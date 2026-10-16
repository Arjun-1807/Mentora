"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  FileUp,
  MailCheck,
  Network,
  ScanText,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.22, 1, 0.36, 1];

const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};
const headlineContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const headlineWord = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

const HEADLINE_LINES = [["Find", "the", "right", "mentor."], ["Automatically."]];
const HEADLINE_TEXT = "Find the right mentor. Automatically.";

const STATS = ["500+ Mentors", "12 Incubators", "89% Meeting Rate"];

const STEPS = [
  {
    icon: FileUp,
    title: "Upload your deck",
    description: "Drop in your pitch deck PDF — no forms, no questionnaires.",
  },
  {
    icon: Sparkles,
    title: "Get matched",
    description: "AI ranks domain-expert mentors by fit, stage and track record.",
  },
  {
    icon: Users,
    title: "Book a meeting",
    description: "Send a personalised intro and lock in a slot on both calendars.",
  },
];

const FEATURES = [
  {
    icon: ScanText,
    title: "AI Extraction",
    description:
      "Reads your pitch deck and pulls out domain, stage, challenges and team gaps — plus tips to make it sharper.",
  },
  {
    icon: Network,
    title: "Semantic Matching",
    description:
      "Embeds your profile and every mentor's expertise, then ranks by real meaning — not keyword overlap.",
  },
  {
    icon: MailCheck,
    title: "Auto Outreach",
    description:
      "Drafts a personalised intro email for each mentor that you can edit and send in one click.",
  },
  {
    icon: BarChart3,
    title: "Outcome Tracking",
    description:
      "Logs every meeting and turns the outcomes into a health score your incubator can act on.",
  },
];

function Hero() {
  return (
    <section className="relative isolate flex min-h-[calc(100svh-4rem)] items-center justify-center overflow-hidden px-6 py-20">
      <div className="hero-orb -z-10" aria-hidden="true" />
      <motion.div
        className="mx-auto flex w-full max-w-3xl flex-col items-center text-center"
        variants={heroContainer}
        initial="hidden"
        animate="show"
      >
        <motion.p
          variants={heroItem}
          className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary"
        >
          AI-Powered Mentor Matching
        </motion.p>

        <motion.h1
          variants={headlineContainer}
          aria-label={HEADLINE_TEXT}
          className="mt-5 font-extrabold tracking-tight text-foreground text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.1]"
        >
          {HEADLINE_LINES.map((line, li) => (
            <span key={li} className="block" aria-hidden="true">
              {line.map((word, wi) => (
                <motion.span
                  key={`${word}-${wi}`}
                  variants={headlineWord}
                  className={cn(
                    "inline-block",
                    wi < line.length - 1 && "mr-[0.25em]",
                    li === 1 && "text-primary"
                  )}
                >
                  {word}
                </motion.span>
              ))}
            </span>
          ))}
        </motion.h1>

        <motion.p
          variants={heroItem}
          className="mt-6 max-w-xl text-base sm:text-lg leading-[1.6] text-muted-foreground"
        >
          Upload your pitch deck. Get matched to domain-expert mentors. Book a meeting — all in
          under 60 seconds.
        </motion.p>

        <motion.div
          variants={heroItem}
          className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row"
        >
          <Button size="lg" className="h-11 w-full px-6 text-base sm:w-auto" render={<Link href="/upload" />}>
            Get Matched
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="h-11 w-full px-6 text-base sm:w-auto"
            render={<Link href="/register?role=mentor" />}
          >
            For Mentors
          </Button>
        </motion.div>

        <motion.ul
          variants={heroItem}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          aria-label="Mentora in numbers"
        >
          {STATS.map((stat, i) => (
            <li key={stat} className="flex items-center gap-3">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted-foreground/60">
                  ·
                </span>
              )}
              <span>{stat}</span>
            </li>
          ))}
        </motion.ul>
      </motion.div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-border px-6 py-24" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          id="how-heading"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          How Mentora works
        </motion.h2>

        <ol className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          {/* Dotted connector through the three step numbers (desktop only). */}
          <span
            aria-hidden="true"
            className="absolute left-[16.67%] right-[16.67%] top-6 hidden border-t-2 border-dotted border-primary/40 md:block"
          />
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.li
                key={step.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.12 }}
                className="relative flex flex-col items-center text-center"
              >
                <span className="relative z-10 flex h-12 min-w-12 items-center justify-center bg-background px-3 text-3xl font-extrabold text-primary tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{step.description}</p>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="px-6 pb-24" aria-labelledby="features-heading">
      <div className="mx-auto max-w-4xl">
        <h2 id="features-heading" className="sr-only">
          Features
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: (i % 2) * 0.08 }}
                className="group rounded-xl border border-border bg-card p-6 transition-colors duration-200 hover:border-primary"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <p className="text-center text-xs text-muted-foreground">
        <span className="font-semibold text-primary">mentora</span>
        <span aria-hidden="true"> · </span>
        Built for incubators
        <span aria-hidden="true"> · </span>
        DSCE Innovation Lab
        <span aria-hidden="true"> · </span>© 2026
      </p>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <HowItWorks />
      <Features />
      <Footer />
    </main>
  );
}
