"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Standard page frame: centred `max-w-6xl` column with the shared padding,
 * fading up into place on mount. `className` merges (e.g. "max-w-lg").
 */
export default function PageWrapper({ children, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn("w-full max-w-6xl mx-auto px-6 py-10", className)}
    >
      {children}
    </motion.div>
  );
}
