"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, FileText, Mail, Sparkles } from "lucide-react";
import ScoreRing from "@/components/ui/ScoreRing";
import { EASE_OUT } from "@/components/motion";

const PROFILE = [
  { label: "Domain", value: "Clean energy" },
  { label: "Stage", value: "MVP" },
  { label: "Gap", value: "Go-to-market" },
  { label: "Geo", value: "Bengaluru" },
];

const MENTORS = [
  { initials: "PK", name: "Priya K.", tag: "Scaled 2 climate-tech startups", score: 94 },
  { initials: "SM", name: "Sameer M.", tag: "Ex-VP Sales, B2B energy", score: 88 },
  { initials: "RV", name: "Rhea V.", tag: "Seed investor, hardware", score: 81 },
];

/**
 * Hero "product preview": a mock of the deck → profile → matches flow in a
 * browser-like frame. It starts tilted back in 3D and flattens as the page
 * scrolls; its contents assemble in sequence on mount. Decorative only —
 * hidden from assistive tech (the hero copy carries the message).
 */
export default function HeroPreview() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [40, 0]);

  return (
    <div ref={ref} aria-hidden="true" className="relative mx-auto w-full max-w-5xl [perspective:1400px]">
      {/* Glow under the frame. */}
      <div className="absolute inset-x-[10%] top-[15%] -z-10 h-[70%] rounded-full bg-primary/25 blur-[90px]" />

      <motion.div
        style={{ rotateX, scale, y, transformOrigin: "50% 0%" }}
        // Only opacity here: y/rotateX/scale are owned by the scroll-linked style.
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.5 }}
        className="surface overflow-hidden rounded-3xl p-1.5 shadow-lift"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/60" />
          <span className="size-2.5 rounded-full bg-warning/60" />
          <span className="size-2.5 rounded-full bg-success/60" />
          <span className="ml-3 hidden h-6 flex-1 items-center rounded-lg bg-muted/70 px-3 font-mono text-[11px] text-muted-foreground sm:flex">
            mentora.app/matches
          </span>
        </div>

        <div className="grid gap-1.5 rounded-[20px] bg-background/60 p-3 sm:p-4 md:grid-cols-[0.9fr_1.1fr]">
          {/* Left: deck + extracted profile */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl bg-primary/12 text-primary">
                <FileText className="size-5" />
                <motion.span
                  className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
                  animate={{ top: ["10%", "90%", "10%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">solargrid_seed_deck.pdf</p>
                <p className="text-xs text-muted-foreground">14 slides · analysed in 6s</p>
              </div>
            </div>

            <div className="rounded-xl bg-muted/50 p-3">
              <p className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                <Sparkles className="size-3" /> Extracted profile
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PROFILE.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 22, delay: 1.1 + i * 0.12 }}
                    className="rounded-lg border border-border bg-card px-2.5 py-2"
                  >
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    <p className="truncate text-xs font-medium text-foreground">{item.value}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5 text-xs text-primary sm:flex">
              <Sparkles className="size-3.5 shrink-0" />
              Tip: add traction numbers to slide 6 to strengthen your ask.
            </div>
          </div>

          {/* Right: ranked mentor matches */}
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Top matches</p>
              <span className="rounded-full bg-success/12 px-2 py-0.5 font-mono text-[10px] font-medium text-success">
                3 of 500+
              </span>
            </div>
            {MENTORS.map((mentor, i) => (
              <motion.div
                key={mentor.name}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 1.5 + i * 0.15 }}
                className={
                  i === 0
                    ? "flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/8 p-2.5"
                    : "flex items-center gap-3 rounded-xl border border-border p-2.5"
                }
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-xs font-semibold text-primary-foreground">
                  {mentor.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{mentor.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{mentor.tag}</p>
                </div>
                <ScoreRing value={mentor.score} size={38} stroke={3.5}>
                  <span className="text-[10px]">{mentor.score}</span>
                </ScoreRing>
              </motion.div>
            ))}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT, delay: 2.1 }}
              className="flex items-center justify-between gap-2 pt-1"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="size-3.5" /> Intro drafted for Priya
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
                Send <ArrowRight className="size-3" />
              </span>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
