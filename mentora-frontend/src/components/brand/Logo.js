import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Mentora mark: two arches (mentor and founder) joined into an "m", with a
 * spark dot above where they meet, on a primary→spark gradient tile.
 */
export function LogoMark({ className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,var(--primary),color-mix(in_oklch,var(--primary),var(--spark)_55%))] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_4px_14px_-4px_color-mix(in_oklch,var(--primary)_70%,transparent)]",
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none">
        <path
          d="M4 18V11.5a4 4 0 0 1 8 0V18M12 11.5a4 4 0 0 1 8 0V18"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="4.2" r="1.7" fill="white" />
      </svg>
    </span>
  );
}

/** Mark + wordmark, linking home. `size` scales both together. */
export default function Logo({ href = "/", size = "md", showWordmark = true, className }) {
  const big = size === "lg";
  return (
    <Link
      href={href}
      aria-label="Mentora home"
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <LogoMark
        className={cn(
          "transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105",
          big && "size-10 rounded-xl"
        )}
      />
      {showWordmark && (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            big ? "text-2xl" : "text-[1.0625rem]"
          )}
        >
          mentora
        </span>
      )}
    </Link>
  );
}
