"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/components/motion";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
          className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/12 text-primary"
        >
          <motion.span
            animate={{ rotate: [0, 18, -12, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
            className="flex"
          >
            <Compass className="size-7" aria-hidden="true" />
          </motion.span>
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}
          className="mt-8 font-mono text-sm text-muted-foreground"
        >
          404
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.18 }}
          className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          This page{" "}
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            wandered off.
          </span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.26 }}
          className="mx-auto mt-3 max-w-sm text-muted-foreground"
        >
          The link may be broken, or the page may have moved.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.34 }}
          className="mt-8"
        >
          <Button size="lg" render={<Link href="/" />}>
            <ArrowLeft aria-hidden="true" />
            Back home
          </Button>
        </motion.div>
      </div>
    </main>
  );
}
