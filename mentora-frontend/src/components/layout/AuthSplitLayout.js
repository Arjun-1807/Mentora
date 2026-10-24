"use client";

import { motion } from "framer-motion";
import { Quote, Sparkles } from "lucide-react";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { EASE_OUT } from "@/components/motion";

/** Mentor "chips" orbiting the testimonial on the brand panel. */
const ORBIT = [
  { initials: "PK", match: 94, className: "left-[8%] top-[18%]", delay: 0.3 },
  { initials: "SM", match: 88, className: "right-[10%] top-[30%]", delay: 0.45 },
  { initials: "RV", match: 91, className: "left-[16%] bottom-[16%]", delay: 0.6 },
];

/**
 * Split-screen frame for /login and /register: a branded panel on the left
 * (aurora gradient, floating match chips, testimonial) and the form on the
 * right. Below `lg` the brand panel collapses to a compact header.
 */
export default function AuthSplitLayout({ children }) {
  return (
    <main className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <aside className="relative isolate flex flex-col justify-between overflow-hidden border-b border-border px-6 py-6 lg:sticky lg:top-0 lg:h-screen lg:w-[44%] lg:border-b-0 lg:border-r lg:px-12 lg:py-10">
        {/* Panel backdrop: deep gradient + grid + two glows. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(160deg,color-mix(in_oklch,var(--primary)_16%,var(--background))_0%,var(--background)_65%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-grid [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div
          aria-hidden="true"
          className="animate-aurora absolute -left-24 -top-24 -z-10 size-96 rounded-full bg-primary/25 blur-[100px]"
        />
        <div
          aria-hidden="true"
          className="animate-aurora absolute -bottom-32 right-0 -z-10 size-80 rounded-full bg-spark/15 blur-[100px]"
          style={{ animationDelay: "-8s" }}
        />

        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle className="lg:hidden" />
        </div>

        <div className="relative hidden flex-1 items-center justify-center lg:flex">
          {ORBIT.map((chip) => (
            <motion.div
              key={chip.initials}
              aria-hidden="true"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20, delay: chip.delay }}
              className={`absolute ${chip.className}`}
            >
              <div
                className="glass animate-float flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 shadow-soft"
                style={{ animationDelay: `${chip.delay * -4}s` }}
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {chip.initials}
                </span>
                <span className="font-mono text-xs font-medium text-success">{chip.match}%</span>
              </div>
            </motion.div>
          ))}

          <motion.figure
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.15 }}
            className="surface relative max-w-sm rounded-3xl p-6"
          >
            <Quote className="size-6 text-primary" aria-hidden="true" />
            <blockquote className="mt-4 text-[0.9375rem] leading-relaxed text-foreground">
              Mentora matched us with a mentor who had scaled a clean-energy startup through the
              exact stage we were stuck at. We booked a call the same afternoon.
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-spark text-xs font-semibold text-primary-foreground"
              >
                AR
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">Ananya R.</span>
                <span className="block text-xs text-muted-foreground">
                  Founder, incubated startup
                </span>
              </span>
            </figcaption>
          </motion.figure>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="mt-6 lg:mt-0"
        >
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI-powered mentor matching
          </p>
          <p className="mt-2 max-w-md text-xl font-semibold leading-snug tracking-tight text-foreground lg:text-3xl lg:leading-[1.15]">
            Connecting startups with the mentors who&apos;ve{" "}
            <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
              been there.
            </span>
          </p>
        </motion.div>
      </aside>

      <section className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:py-12">
        <div className="absolute right-6 top-6 hidden lg:block">
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.05 }}
          className="w-full max-w-md"
        >
          {children}
        </motion.div>
      </section>
    </main>
  );
}
