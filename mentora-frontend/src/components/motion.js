"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/*
 * Shared animation primitives. Every page's entrance animation goes through
 * these so timings stay consistent:
 *
 *   <Stagger>            container; children reveal 0.1s apart
 *     <FadeIn>…</FadeIn> fade + slide up from y: 20
 *     <HoverCard>…</HoverCard> same entrance, plus a subtle lift on hover
 *   </Stagger>
 *
 * FadeIn/HoverCard inherit their "hidden" -> "show" transition from the
 * nearest Stagger, so they must be rendered inside one (PageShell provides
 * one for every page). Reduced-motion users get opacity-only transitions via
 * the <MotionConfig reducedMotion="user"> in PageTransition.
 */

const EASE_OUT = [0.22, 1, 0.36, 1];

export const fadeUpVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

function containerVariants(stagger, delay) {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
}

export function Stagger({ children, className, stagger = 0.1, delay = 0, as = "div", ...props }) {
  const Component = motion[as] ?? motion.div;
  return (
    <Component
      className={className}
      variants={containerVariants(stagger, delay)}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </Component>
  );
}

export function FadeIn({ children, className, as = "div", ...props }) {
  const Component = motion[as] ?? motion.div;
  return (
    <Component className={className} variants={fadeUpVariants} {...props}>
      {children}
    </Component>
  );
}

/** Entrance like FadeIn, and lifts 2px with a soft shadow on hover. */
export function HoverCard({ children, className, ...props }) {
  return (
    <motion.div
      className={cn("h-full [&>[data-slot=card]]:h-full", className)}
      variants={fadeUpVariants}
      whileHover={{
        y: -2,
        boxShadow: "0 14px 30px -18px rgb(0 0 0 / 0.65)",
        transition: { duration: 0.2, ease: EASE_OUT },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

const wordVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/**
 * Reveals a heading word by word (0.05s apart). Screen readers get the
 * whole sentence once via aria-label; the animated spans are hidden from them.
 */
export function AnimatedWords({ text, className, as = "h1", stagger = 0.05 }) {
  const Component = motion[as] ?? motion.h1;
  const words = text.split(" ");
  return (
    <Component
      className={className}
      aria-label={text}
      variants={containerVariants(stagger, 0)}
      initial="hidden"
      animate="show"
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          aria-hidden="true"
          variants={wordVariants}
          className="inline-block"
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </Component>
  );
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Counts from 0 up to `target` on mount (and whenever `target` changes),
 * using a plain interval with an ease-out curve. Non-numeric targets (like
 * "—") are passed straight through.
 */
export function useCountUp(target, { duration = 900, decimals = 0 } = {}) {
  const numeric = typeof target === "number" && Number.isFinite(target);
  const [value, setValue] = useState(numeric ? 0 : target);

  useEffect(() => {
    if (!numeric || target === 0 || prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }

    const tick = 16;
    const steps = Math.max(1, Math.round(duration / tick));
    let step = 0;
    setValue(0);

    const id = setInterval(() => {
      step += 1;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      if (step >= steps) {
        setValue(target);
        clearInterval(id);
      } else {
        setValue(Number((target * eased).toFixed(decimals)));
      }
    }, tick);

    return () => clearInterval(id);
  }, [numeric, target, duration, decimals]);

  return value;
}

/** Renders `useCountUp` output, formatted to a fixed number of decimals. */
export function CountUp({ value, decimals = 0, suffix = "", duration }) {
  const current = useCountUp(value, { decimals, duration });
  if (typeof current !== "number") return <>{current}</>;
  return (
    <>
      {current.toFixed(decimals)}
      {suffix}
    </>
  );
}
