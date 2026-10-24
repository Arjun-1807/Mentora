"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { cn } from "@/lib/utils";

/*
 * Shared animation primitives. Every page's motion goes through these so
 * timings and feel stay consistent:
 *
 *   <Stagger>                 container; children reveal 0.08s apart on mount
 *     <FadeIn>…</FadeIn>      fade + slide up (inherits from nearest Stagger)
 *     <HoverCard>…</HoverCard> same entrance, plus a lift on hover
 *   </Stagger>
 *
 *   <Reveal>                  standalone: fades up when scrolled into view
 *   <SpotlightCard>           surface card with a cursor-following glow
 *   <Magnetic>                child drifts towards the cursor (hero CTAs)
 *   <CountUp value={42} />    number tween, spring-eased, starts when visible
 *
 * Reduced-motion users get opacity-only transitions via the
 * <MotionConfig reducedMotion="user"> in PageTransition.
 */

export const EASE_OUT = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];

/** Spring presets: `snappy` for UI feedback, `soft` for layout, `bouncy` for delight. */
export const SPRING = {
  snappy: { type: "spring", stiffness: 500, damping: 32, mass: 0.6 },
  soft: { type: "spring", stiffness: 260, damping: 30 },
  bouncy: { type: "spring", stiffness: 380, damping: 18 },
};

export const fadeUpVariants = {
  hidden: { opacity: 0, y: 18, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: EASE_OUT },
    // A resting filter (even blur(0px)) creates a containing block that
    // breaks position:fixed descendants, so remove it once settled.
    transitionEnd: { filter: "none" },
  },
};

export const scaleInVariants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
};

export function containerVariants(stagger = 0.08, delay = 0) {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
}

export function Stagger({
  children,
  className,
  stagger = 0.08,
  delay = 0,
  as = "div",
  inView = false,
  ...props
}) {
  const Component = motion[as] ?? motion.div;
  const trigger = inView
    ? { whileInView: "show", viewport: { once: true, margin: "-60px" } }
    : { animate: "show" };
  return (
    <Component
      className={className}
      variants={containerVariants(stagger, delay)}
      initial="hidden"
      {...trigger}
      {...props}
    >
      {children}
    </Component>
  );
}

export function FadeIn({ children, className, as = "div", variants = fadeUpVariants, ...props }) {
  const Component = motion[as] ?? motion.div;
  return (
    <Component className={className} variants={variants} {...props}>
      {children}
    </Component>
  );
}

/** Standalone scroll-triggered fade-up, for content outside a <Stagger>. */
export function Reveal({ children, className, as = "div", delay = 0, y = 24, ...props }) {
  const Component = motion[as] ?? motion.div;
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.65, ease: EASE_OUT, delay }}
      {...props}
    >
      {children}
    </Component>
  );
}

/** Entrance like FadeIn, and lifts 3px with a deeper shadow on hover. */
export function HoverCard({ children, className, ...props }) {
  return (
    <motion.div
      className={cn(
        "h-full rounded-2xl [&>[data-slot=card]]:h-full transition-shadow duration-300 hover:shadow-lift",
        className
      )}
      variants={fadeUpVariants}
      whileHover={{ y: -3, transition: SPRING.snappy }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Card surface with a soft radial glow that follows the cursor, plus a
 * brighter rim where the glow meets the border. Falls back to a plain
 * surface for touch / reduced-motion users (the glow only shows on hover).
 */
export function SpotlightCard({
  children,
  className,
  glow = "var(--primary)",
  size = 340,
  as = "div",
  ...props
}) {
  const Component = motion[as] ?? motion.div;
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const background = useMotionTemplate`radial-gradient(${size}px circle at ${x}px ${y}px, color-mix(in oklch, ${glow} 14%, transparent), transparent 70%)`;
  const rim = useMotionTemplate`radial-gradient(${size * 0.6}px circle at ${x}px ${y}px, color-mix(in oklch, ${glow} 55%, transparent), transparent 70%)`;

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  }

  return (
    <Component
      onPointerMove={handleMove}
      className={cn("group/spotlight surface relative isolate overflow-hidden rounded-2xl", className)}
      {...props}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover/spotlight:opacity-100"
        style={{ background }}
      />
      {/* Rim light: the same glow, masked to a 1px border ring. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/spotlight:opacity-100"
        style={{
          background: rim,
          padding: 1,
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {children}
    </Component>
  );
}

/** Drifts its child towards the cursor while hovered, springing back on leave. */
export function Magnetic({ children, className, strength = 0.25 }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, SPRING.soft);
  const y = useSpring(0, SPRING.soft);

  function handleMove(event) {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      className={cn("inline-flex", className)}
      style={{ x, y }}
      onPointerMove={handleMove}
      onPointerLeave={reset}
    >
      {children}
    </motion.div>
  );
}

const wordVariants = {
  hidden: { opacity: 0, y: "0.4em", filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: EASE_OUT },
    transitionEnd: { filter: "none" },
  },
};

/**
 * Reveals a heading word by word. Screen readers get the whole sentence once
 * via aria-label; the animated spans are hidden from them.
 */
export function AnimatedWords({ text, className, as = "h1", stagger = 0.06, delay = 0 }) {
  const Component = motion[as] ?? motion.h1;
  const words = text.split(" ");
  return (
    <Component
      className={className}
      aria-label={text}
      variants={containerVariants(stagger, delay)}
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

export { wordVariants };

/**
 * Tweens from 0 to `target` (ease-out, via framer's `animate`) once the
 * returned ref's element is in view, and again whenever `target` changes.
 * Non-numeric targets (like "—") are passed straight through.
 */
export function useCountUp(target, { duration = 1.1, decimals = 0 } = {}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const numeric = typeof target === "number" && Number.isFinite(target);
  const [value, setValue] = useState(numeric ? 0 : target);

  useEffect(() => {
    if (!numeric) {
      setValue(target);
      return undefined;
    }
    if (reduce || target === 0) {
      setValue(target);
      return undefined;
    }
    if (!inView) return undefined;
    const controls = animate(0, target, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setValue(Number(v.toFixed(decimals))),
    });
    return () => controls.stop();
  }, [numeric, target, duration, decimals, inView, reduce]);

  return [value, ref];
}

/** Renders `useCountUp` output, formatted to a fixed number of decimals. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration, className }) {
  const [current, ref] = useCountUp(value, { decimals, duration });
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {typeof current === "number" ? `${prefix}${current.toFixed(decimals)}${suffix}` : current}
    </span>
  );
}
