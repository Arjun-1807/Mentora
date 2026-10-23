"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/components/motion";

/**
 * Standard content column: centred `max-w-6xl` with the shared padding,
 * fading up into place on mount. `className` merges (e.g. "max-w-lg").
 */
export default function PageWrapper({ children, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className={cn("w-full max-w-6xl mx-auto px-6 py-10", className)}
    >
      {children}
    </motion.div>
  );
}
