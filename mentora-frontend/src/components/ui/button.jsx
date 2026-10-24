"use client"

import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-200 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Solid primary with a top highlight and a coloured glow on hover.
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_1px_2px_0_var(--shadow-color)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_10%)] hover:shadow-glow",
        outline:
          "border-border bg-card/60 text-foreground shadow-[0_1px_2px_0_var(--shadow-color)] hover:border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary",
        // Tinted primary — for secondary actions that should still read as "brand".
        soft: "bg-primary/12 text-primary hover:bg-primary/20",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/30",
        link: "h-auto! px-0! text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-lg px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[0.9375rem]",
        xl: "h-12 gap-2.5 rounded-2xl px-6 text-base",
        icon: "size-9",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Press feedback comes from framer-motion's whileTap, so the motion wrapper
// sits on the base-ui primitive itself; that keeps `render={<Link />}` and
// every other primitive prop working unchanged.
const MotionButtonPrimitive = motion.create(ButtonPrimitive)

const TAP = { scale: 0.96 }
const TAP_TRANSITION = { type: "spring", stiffness: 520, damping: 30, mass: 0.6 }

// forwardRef matters: base-ui triggers (`<PopoverTrigger render={<Button />}>`)
// pass a ref to anchor their popup. On React 18 a plain function component
// drops it, and the popup opens unpositioned at opacity 0 — i.e. invisible.
const Button = React.forwardRef(function Button(
  {
    className,
    variant = "default",
    size = "default",
    disabled,
    ...props
  },
  ref
) {
  return (
    <MotionButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled}
      whileTap={disabled ? undefined : TAP}
      transition={TAP_TRANSITION}
      {...props}
    />
  )
})

export { Button, buttonVariants }
