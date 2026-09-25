"use client";

import { useContext, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
// Not a public Next.js export, but the standard way to get exit animations
// with the App Router: without freezing it, the outgoing page would re-render
// with the *incoming* route's content while it animates out.
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

function FrozenRouter({ children }) {
  const context = useContext(LayoutRouterContext);
  const frozen = useRef(context).current;
  return (
    <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>
  );
}

/**
 * Cross-fades between routes. Keyed on the pathname so every navigation
 * plays a short exit, then the next page's own staggered entrance.
 * `reducedMotion="user"` drops transforms for prefers-reduced-motion users.
 */
export default function PageTransition({ children }) {
  const pathname = usePathname();

  return (
    <MotionConfig reducedMotion="user">
      {/* No initial={false} here: it would propagate to every descendant and
          suppress each page's own entrance animation on first load. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname}
          className="flex-1 flex flex-col"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } }}
        >
          <FrozenRouter>{children}</FrozenRouter>
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
