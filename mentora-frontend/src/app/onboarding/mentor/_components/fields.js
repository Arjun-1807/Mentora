"use client";

// Form pieces shared by /register (mentor fields) and /onboarding/mentor.
// Lives in a `_components` private folder so the App Router ignores it.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";
import { SECTOR_OPTIONS, sectorLabel } from "@/lib/validation";

/** Field-level error line; slides in under its input. */
export function FieldError({ id, message }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.p
          key="error"
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

/** "(optional)" marker used next to labels. */
export function OptionalTag() {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      optional
    </span>
  );
}

/**
 * Labelled Select. `options` is a list of strings or `{value, label}`;
 * `format` maps a value to its display text.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  format,
  disabled,
  optional,
}) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const show = (v) => {
    if (format) return format(v);
    return items.find((o) => o.value === v)?.label ?? v;
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {optional && <OptionalTag />}
      </Label>
      <Select value={value || null} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-11 w-full"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={placeholder}>
            {(current) => (current ? show(current) : placeholder)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {format ? format(option.value) : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * Searchable multi-select for sectors (Command inside a Popover), with the
 * picks shown as removable chips that pop in and out. Values are the backend
 * literals ("Others"); labels are what the UI shows ("Other").
 */
export function SectorMultiSelect({
  id = "sector-expertise",
  label = "Sector expertise",
  value,
  onChange,
  error,
  hint,
  disabled,
}) {
  const [open, setOpen] = useState(false);

  function toggle(sector) {
    onChange(value.includes(sector) ? value.filter((s) => s !== sector) : [...value, sector]);
  }

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="h-11 w-full justify-between rounded-xl bg-card/70 px-3.5 font-normal hover:bg-card/70 hover:text-foreground"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={describedBy}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            {value.length > 0 && (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold tabular-nums text-primary-foreground">
                {value.length}
              </span>
            )}
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0
                ? "Search and select sectors"
                : `sector${value.length === 1 ? "" : "s"} selected`}
            </span>
          </span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search sectors…" />
            <CommandList>
              <CommandEmpty>No sector found.</CommandEmpty>
              <CommandGroup>
                {SECTOR_OPTIONS.map((sector) => {
                  const selected = value.includes(sector);
                  return (
                    <CommandItem
                      key={sector}
                      value={sectorLabel(sector)}
                      data-checked={selected}
                      onSelect={() => toggle(sector)}
                    >
                      {sectorLabel(sector)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-0.5" aria-label="Selected sectors">
          <AnimatePresence initial={false}>
            {value.map((sector) => (
              <motion.li
                key={sector}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={SPRING.snappy}
              >
                <span className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary">
                  <Check className="size-3" aria-hidden="true" />
                  {sectorLabel(sector)}
                  <button
                    type="button"
                    onClick={() => toggle(sector)}
                    disabled={disabled}
                    className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`Remove ${sectorLabel(sector)}`}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
