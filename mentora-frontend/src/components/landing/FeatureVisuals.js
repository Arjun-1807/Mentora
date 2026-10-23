"use client";

import { motion } from "framer-motion";
import { EASE_OUT } from "@/components/motion";

/*
 * Small decorative illustrations for the landing page's feature bento. Each
 * one animates when scrolled into view. All are aria-hidden: the card copy
 * next to them carries the meaning.
 */

const inView = { once: true, margin: "-60px" };

/** Pitch-deck text resolving into structured field chips. */
export function ExtractionVisual() {
  const chips = ["Fintech", "Seed", "Hiring CTO", "Unit economics", "Mumbai"];
  return (
    <div aria-hidden="true" className="relative flex h-full min-h-40 flex-col justify-center gap-3">
      <div className="space-y-1.5">
        {[92, 78, 85, 60].map((w, i) => (
          <motion.div
            key={i}
            className="h-1.5 rounded-full bg-muted-foreground/20"
            style={{ width: `${w}%` }}
            initial={{ opacity: 0.2 }}
            whileInView={{ opacity: [0.2, 0.7, 0.35] }}
            viewport={inView}
            transition={{ duration: 1.2, delay: i * 0.12 }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip, i) => (
          <motion.span
            key={chip}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={inView}
            transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.5 + i * 0.1 }}
            className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {chip}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

const NODES = [
  { x: 50, y: 50, r: 9, core: true },
  { x: 18, y: 26, r: 5 },
  { x: 82, y: 22, r: 6 },
  { x: 88, y: 70, r: 5 },
  { x: 24, y: 80, r: 6 },
  { x: 60, y: 88, r: 4 },
  { x: 40, y: 12, r: 4 },
];

/** A startup node at the centre drawing lines to its nearest mentors. */
export function MatchingVisual() {
  const core = NODES[0];
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className="h-full min-h-40 w-full overflow-visible">
      {NODES.slice(1).map((node, i) => (
        <motion.line
          key={`l-${i}`}
          x1={core.x}
          y1={core.y}
          x2={node.x}
          y2={node.y}
          stroke={i < 3 ? "var(--primary)" : "var(--border)"}
          strokeWidth={i < 3 ? 0.8 : 0.5}
          strokeDasharray={i < 3 ? "0" : "2 2"}
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={inView}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.2 + i * 0.1 }}
        />
      ))}
      {NODES.slice(1).map((node, i) => (
        <motion.circle
          key={`n-${i}`}
          cx={node.x}
          cy={node.y}
          r={node.r}
          fill={i < 3 ? "var(--primary)" : "var(--muted)"}
          fillOpacity={i < 3 ? 0.9 : 1}
          stroke="var(--card)"
          strokeWidth={1.5}
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={inView}
          transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.4 + i * 0.08 }}
        />
      ))}
      <motion.circle
        cx={core.x}
        cy={core.y}
        r={core.r + 6}
        fill="none"
        stroke="var(--spark)"
        strokeWidth={0.6}
        animate={{ r: [core.r + 4, core.r + 12], opacity: [0.8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      />
      <circle cx={core.x} cy={core.y} r={core.r} fill="var(--spark)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}

/** An intro email writing itself line by line. */
export function OutreachVisual() {
  const lines = [100, 92, 96, 70];
  return (
    <div aria-hidden="true" className="flex h-full min-h-40 flex-col justify-center">
      <div className="rounded-xl border border-border bg-background/60 p-3.5">
        <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
          <span className="font-mono text-[10px] text-muted-foreground">To</span>
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            priya@mentor.vc
          </span>
        </div>
        <div className="space-y-2">
          {lines.map((w, i) => (
            <motion.div
              key={i}
              className="h-1.5 origin-left rounded-full bg-muted-foreground/25"
              style={{ width: `${w}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={inView}
              transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.3 + i * 0.35 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Meeting outcomes rolling up into a rising bar chart. */
export function OutcomeVisual() {
  const bars = [38, 52, 46, 64, 72, 88];
  return (
    <div aria-hidden="true" className="flex h-full min-h-40 items-end gap-2 px-1">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          className={
            i === bars.length - 1
              ? "flex-1 origin-bottom rounded-t-md bg-gradient-to-t from-primary to-spark"
              : "flex-1 origin-bottom rounded-t-md bg-primary/25"
          }
          style={{ height: `${h}%` }}
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={inView}
          transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.15 + i * 0.08 }}
        />
      ))}
    </div>
  );
}
