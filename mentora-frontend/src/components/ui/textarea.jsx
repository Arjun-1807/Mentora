import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-xl border border-input bg-card/70 px-3.5 py-2.5 text-base leading-relaxed shadow-[0_1px_2px_0_var(--shadow-color)] transition-[border-color,box-shadow,background-color] duration-200 outline-none hover:border-[color-mix(in_oklch,var(--primary)_30%,var(--input))] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
