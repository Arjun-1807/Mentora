"use client";

// Form pieces shared by /register (mentor fields) and /onboarding/mentor.
// Lives in a `_components` private folder so the App Router ignores it.

import { useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { SECTOR_OPTIONS, sectorLabel } from "@/lib/validation";

export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
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
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <Select value={value || null} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-10 w-full"
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
 * picks shown as removable Badges. Values are the backend literals
 * ("Others"); labels are what the UI shows ("Other").
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
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="h-10 w-full justify-between font-normal"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={describedBy}
            />
          }
        >
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
            {value.length === 0
              ? "Search and select sectors"
              : `${value.length} sector${value.length === 1 ? "" : "s"} selected`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" aria-hidden="true" />
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
        <ul className="flex flex-wrap gap-2 pt-1" aria-label="Selected sectors">
          {value.map((sector) => (
            <li key={sector}>
              <Badge variant="secondary" className="h-6 gap-1 pr-1">
                {sectorLabel(sector)}
                <button
                  type="button"
                  onClick={() => toggle(sector)}
                  disabled={disabled}
                  className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-foreground/10 hover:text-foreground"
                  aria-label={`Remove ${sectorLabel(sector)}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
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
