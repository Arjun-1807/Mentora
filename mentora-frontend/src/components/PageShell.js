import { cn } from "@/lib/utils";
import { FadeIn, Stagger } from "@/components/motion";

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  full: "max-w-5xl",
};

/**
 * Standard page frame: a `<main>` with the app's shared padding and a
 * centered content column (the navbar is rendered once, in the root layout).
 * The column is a <Stagger> container, so any <FadeIn>/<HoverCard> inside a
 * page reveals in order, 0.1s apart.
 */
export function PageShell({ children, width = "xl", center = false, className }) {
  return (
    <main
      className={cn(
        "flex-1 w-full px-4 sm:px-6 py-10 sm:py-14",
        center && "flex items-center justify-center"
      )}
    >
      <Stagger className={cn("w-full mx-auto", WIDTHS[width] ?? WIDTHS.xl, className)}>
        {children}
      </Stagger>
    </main>
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
        <FadeIn
          as="h1"
          className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground"
        >
          {title}
        </FadeIn>
        {description && (
          <FadeIn
            as="p"
            className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed"
          >
            {description}
          </FadeIn>
        )}
      </div>
      {actions && (
        <FadeIn className={cn("flex items-center gap-2", centered && "mt-6 justify-center")}>
          {actions}
        </FadeIn>
      )}
    </div>
  );
}
