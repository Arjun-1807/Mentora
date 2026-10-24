import { cn } from "@/lib/utils";
import { FadeIn, Stagger } from "@/components/motion";

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  wide: "max-w-4xl",
  full: "max-w-6xl",
};

/**
 * Standard page frame: a `<main>` with the app's shared padding and a
 * centered content column (the navbar is rendered once, in the root layout).
 * The column is a <Stagger> container, so any <FadeIn>/<HoverCard> inside a
 * page reveals in order.
 */
export function PageShell({ children, width = "xl", center = false, className }) {
  return (
    <main
      className={cn(
        "flex-1 w-full px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10",
        center && "flex items-center justify-center"
      )}
    >
      <Stagger className={cn("w-full mx-auto", WIDTHS[width] ?? WIDTHS.xl, className)}>
        {children}
      </Stagger>
    </main>
  );
}

/**
 * Shared title block used at the top of each page: optional mono eyebrow,
 * a large tracking-tight title, description and right-aligned actions.
 */
export function PageHeader({ eyebrow, title, description, align = "left", actions, className }) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "mb-8 sm:mb-12",
        centered
          ? "text-center"
          : "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className={cn("min-w-0", centered && "mx-auto max-w-2xl")}>
        {eyebrow && (
          <FadeIn as="p" className="eyebrow mb-3">
            {eyebrow}
          </FadeIn>
        )}
        <FadeIn
          as="h1"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          {title}
        </FadeIn>
        {description && (
          <FadeIn
            as="p"
            className={cn(
              "mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-base",
              centered && "mx-auto"
            )}
          >
            {description}
          </FadeIn>
        )}
      </div>
      {actions && (
        <FadeIn
          className={cn("flex shrink-0 items-center gap-2", centered && "mt-6 justify-center")}
        >
          {actions}
        </FadeIn>
      )}
    </div>
  );
}
