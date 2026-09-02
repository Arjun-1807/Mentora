import { cn } from "@/lib/utils";
import Navbar from "@/components/Navbar";

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  full: "max-w-5xl",
};

/**
 * Standard page frame: navbar + a `<main>` with the app's shared padding and
 * a centered content column. Keeps every route's gutters and max-widths in
 * one place instead of re-declaring them per page.
 */
export function PageShell({ children, width = "xl", center = false, className }) {
  return (
    <>
      <Navbar />
      <main
        className={cn(
          "flex-1 w-full px-4 sm:px-6 py-10 sm:py-14",
          center && "flex items-center justify-center"
        )}
      >
        <div className={cn("w-full mx-auto", WIDTHS[width] ?? WIDTHS.xl, className)}>
          {children}
        </div>
      </main>
    </>
  );
}

/** Shared title/description block used at the top of each page. */
export function PageHeader({ title, description, align = "left", actions, className }) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "mb-8 sm:mb-10",
        centered
          ? "text-center"
          : "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className={cn(centered && "mx-auto max-w-2xl")}>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className={cn("flex items-center gap-2", centered && "mt-6 justify-center")}>
          {actions}
        </div>
      )}
    </div>
  );
}
