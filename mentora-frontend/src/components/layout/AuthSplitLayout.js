"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const EASE_OUT = [0.22, 1, 0.36, 1];

/**
 * Split-screen frame for /login and /register: a branded panel (42%) on the
 * left and the form (58%) on the right. Below `lg` the panels stack and the
 * brand panel shrinks to a compact header.
 */
export default function AuthSplitLayout({ children }) {
  return (
    <main className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <aside className="relative isolate flex flex-col justify-between overflow-hidden border-b border-border bg-gradient-to-br from-[oklch(0.696_0.17_162.48/0.15)] to-transparent px-6 py-8 lg:w-[42%] lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 -z-10 h-80 w-80 rounded-full bg-primary/10 blur-3xl"
        />
        <Link
          href="/"
          className="w-fit rounded-md text-2xl font-extrabold tracking-tight text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          mentora
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="mt-6 lg:mt-0"
        >
          <p className="max-w-sm text-xl font-semibold leading-snug text-foreground lg:text-3xl lg:leading-tight">
            Connecting startups with the mentors who&apos;ve been there.
          </p>
        </motion.div>

        <motion.div
          className="mt-10 hidden lg:block"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: [0, -8, 0] }}
          transition={{
            opacity: { duration: 0.6, delay: 0.2 },
            y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.8 },
          }}
        >
          <Card className="max-w-sm bg-card/80 backdrop-blur shadow-xl shadow-black/30">
            <CardContent className="space-y-4">
              <Quote className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-foreground">
                &ldquo;Mentora matched us with a mentor who had scaled a clean-energy startup
                through the exact stage we were stuck at. We booked a call the same afternoon.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                >
                  AR
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">Ananya R.</p>
                  <p className="text-xs text-muted-foreground">Founder, incubated startup</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </aside>

      <section className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:w-[58%] lg:py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          {children}
        </motion.div>
      </section>
    </main>
  );
}
