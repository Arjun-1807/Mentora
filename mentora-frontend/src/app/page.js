"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  FileUp,
  GraduationCap,
  Rocket,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/brand/Logo";
import HeroPreview from "@/components/landing/HeroPreview";
import {
  ExtractionVisual,
  MatchingVisual,
  OutcomeVisual,
  OutreachVisual,
} from "@/components/landing/FeatureVisuals";
import {
  CountUp,
  EASE_OUT,
  FadeIn,
  Magnetic,
  Reveal,
  SpotlightCard,
  Stagger,
  wordVariants,
  containerVariants,
} from "@/components/motion";
import { cn } from "@/lib/utils";

const STATS = [
  { value: 500, suffix: "+", label: "Domain-expert mentors" },
  { value: 12, suffix: "", label: "Partner incubators" },
  { value: 89, suffix: "%", label: "Intros that become meetings" },
  { value: 60, prefix: "<", suffix: "s", label: "From deck to matches" },
];

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
    icon: CalendarCheck,
    title: "Book a meeting",
    description: "Send a personalised intro and lock in a slot on both calendars.",
  },
];

const FEATURES = [
  {
    eyebrow: "AI extraction",
    title: "Your deck, understood",
    description:
      "Reads your pitch deck and pulls out domain, stage, challenges and team gaps — plus tips to make it sharper.",
    visual: ExtractionVisual,
    className: "md:col-span-4",
  },
  {
    eyebrow: "Semantic matching",
    title: "Meaning over keywords",
    description: "Embeds your profile and every mentor's expertise, then ranks by real fit.",
    visual: MatchingVisual,
    className: "md:col-span-2",
  },
  {
    eyebrow: "Auto outreach",
    title: "Intros that write themselves",
    description: "A personalised email for each mentor — edit it, send it in one click.",
    visual: OutreachVisual,
    className: "md:col-span-3",
  },
  {
    eyebrow: "Outcome tracking",
    title: "Every meeting counts",
    description: "Outcomes roll up into a health score your incubator can act on.",
    visual: OutcomeVisual,
    className: "md:col-span-3",
  },
];

const ROLES = [
  {
    icon: Rocket,
    title: "Founders",
    description: "Skip the cold outreach. Get warm intros to people who've solved your exact problem.",
    href: "/register",
    cta: "Get matched",
  },
  {
    icon: GraduationCap,
    title: "Mentors",
    description: "Only see founders where your experience genuinely moves the needle.",
    href: "/register?role=mentor",
    cta: "Join as a mentor",
  },
  {
    icon: Building2,
    title: "Incubators",
    description: "See every startup's health, meetings and momentum across your cohort.",
    href: "/register?role=coordinator",
    cta: "Set up a cohort",
  },
];

const HEADLINE = [
  { text: "Find", accent: false },
  { text: "the", accent: false },
  { text: "mentor", accent: false },
  { text: "who's", accent: false },
  { text: "already", accent: true },
  { text: "been", accent: true },
  { text: "there.", accent: true },
];

function Hero() {
  return (
    <section className="relative px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <Stagger className="mx-auto flex max-w-4xl flex-col items-center text-center" stagger={0.1}>
        <FadeIn>
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-3 text-xs font-medium text-muted-foreground shadow-soft backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-primary">New</span>
            Book mentors straight into Google Calendar
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </FadeIn>

        <motion.h1
          aria-label="Find the mentor who's already been there."
          variants={containerVariants(0.06, 0.15)}
          className="mt-7 text-[clamp(2.6rem,7vw,5.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground"
        >
          {HEADLINE.map((word, i) => (
            <motion.span
              key={`${word.text}-${i}`}
              aria-hidden="true"
              variants={wordVariants}
              className={cn(
                "inline-block",
                word.accent &&
                  "font-display text-[1.1em] font-normal italic tracking-[-0.01em] text-gradient-primary pr-[0.06em]"
              )}
            >
              {word.text}
              {i < HEADLINE.length - 1 ? " " : ""}
            </motion.span>
          ))}
        </motion.h1>

        <FadeIn
          as="p"
          className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          Upload your pitch deck. Mentora reads it, ranks 500+ domain experts by real fit, drafts the
          intro and books the call — in under a minute.
        </FadeIn>

        <FadeIn className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <Magnetic className="w-full sm:w-auto">
            <Button size="xl" className="w-full sm:w-auto" render={<Link href="/upload" />}>
              Get matched
              <ArrowRight
                className="transition-transform duration-300 group-hover/button:translate-x-1"
                aria-hidden="true"
              />
            </Button>
          </Magnetic>
          <Button
            size="xl"
            variant="outline"
            className="w-full sm:w-auto"
            render={<Link href="/register?role=mentor" />}
          >
            I&apos;m a mentor
          </Button>
        </FadeIn>

      </Stagger>

      <div className="mt-16 sm:mt-20">
        <HeroPreview />
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section aria-label="Mentora in numbers" className="px-4 py-16 sm:px-6">
      <Stagger
        inView
        as="dl"
        className="mx-auto grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-4"
      >
        {STATS.map((stat) => (
          <FadeIn
            key={stat.label}
            className="flex flex-col-reverse bg-card/80 px-5 py-7 text-center backdrop-blur sm:px-6"
          >
            <dt className="mt-1.5 text-xs text-muted-foreground sm:text-sm">{stat.label}</dt>
            <dd className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              <CountUp value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
            </dd>
          </FadeIn>
        ))}
      </Stagger>
    </section>
  );
}

function SectionHeading({ id, eyebrow, title, accent, description }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2
        id={id}
        className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-5xl"
      >
        {title}{" "}
        {accent && (
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            {accent}
          </span>
        )}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{description}</p>
      )}
    </Reveal>
  );
}

function HowItWorks() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 60%"] });
  const progress = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section className="px-4 py-24 sm:px-6" aria-labelledby="how-heading">
      <SectionHeading
        id="how-heading"
        eyebrow="How it works"
        title="Three steps to the"
        accent="right room."
      />

      <div ref={ref} className="relative mx-auto mt-16 max-w-5xl">
        {/* Progress rail: fills as the section scrolls through (desktop). */}
        <div
          aria-hidden="true"
          className="absolute left-[16.67%] right-[16.67%] top-7 hidden h-px bg-border md:block"
        >
          <motion.div
            style={{ scaleX: progress }}
            className="h-full origin-left bg-gradient-to-r from-primary via-primary to-spark"
          />
        </div>

        <ol className="grid gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal
                as="li"
                key={step.title}
                delay={i * 0.12}
                className="relative flex flex-col items-center text-center"
              >
                <span className="surface relative z-10 flex size-14 items-center justify-center rounded-2xl text-primary">
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-semibold text-primary-foreground ring-4 ring-background">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="px-4 py-24 sm:px-6" aria-labelledby="features-heading">
      <SectionHeading
        id="features-heading"
        eyebrow="Features"
        title="Everything between a deck and a"
        accent="great meeting."
        description="One flow replaces the spreadsheet of names, the cold emails and the scheduling back-and-forth."
      />

      <div className="mx-auto mt-14 grid max-w-6xl gap-4 md:grid-cols-6">
        {FEATURES.map((feature, i) => {
          const Visual = feature.visual;
          return (
            <Reveal key={feature.title} delay={(i % 2) * 0.08} className={feature.className}>
              <SpotlightCard className="flex h-full flex-col gap-6 p-6 sm:p-7">
                <div className="flex-1">
                  <Visual />
                </div>
                <div>
                  <p className="eyebrow">{feature.eyebrow}</p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </SpotlightCard>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Roles() {
  return (
    <section className="px-4 py-24 sm:px-6" aria-labelledby="roles-heading">
      <SectionHeading
        id="roles-heading"
        eyebrow="Built for the whole ecosystem"
        title="One platform,"
        accent="three sides."
      />
      <Stagger inView className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
        {ROLES.map((role) => {
          const Icon = role.icon;
          return (
            <FadeIn key={role.title}>
              <Link
                href={role.href}
                className="group surface relative flex h-full flex-col rounded-2xl p-6 outline-none transition-[box-shadow,transform] duration-300 hover:-translate-y-1 hover:shadow-lift focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
                  For {role.title.toLowerCase()}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {role.description}
                </p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {role.cta}
                  <ArrowUpRight
                    className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            </FadeIn>
          );
        })}
      </Stagger>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-24 pt-8 sm:px-6">
      <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-primary/25 px-6 py-16 text-center sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_28%,var(--card)),var(--card)_70%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
        />
        <motion.div
          aria-hidden="true"
          className="absolute -bottom-24 left-1/2 -z-10 h-48 w-[60%] -translate-x-1/2 rounded-full bg-spark/25 blur-[80px]"
          animate={{ opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-5xl">
          Your next mentor is{" "}
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            one upload away.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-md text-base text-muted-foreground">
          Drop your deck in, see your top five matches, and send the first intro today.
        </p>
        <div className="mt-9 flex justify-center">
          <Magnetic>
            <Button size="xl" render={<Link href="/upload" />}>
              Upload your deck
              <ArrowRight
                className="transition-transform duration-300 group-hover/button:translate-x-1"
                aria-hidden="true"
              />
            </Button>
          </Magnetic>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo />
        <p className="text-center text-xs text-muted-foreground">
          Built for incubators · DSCE Innovation Lab · © 2026
        </p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <motion.main
      className="flex flex-1 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <Hero />
      <Stats />
      <HowItWorks />
      <Features />
      <Roles />
      <FinalCta />
      <Footer />
    </motion.main>
  );
}
