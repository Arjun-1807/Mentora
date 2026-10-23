"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, Clock, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/StateCard";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";
import { getMentorSlots, saveCalendarSlots } from "@/lib/api";
import {
  DAYS,
  DAY_END,
  DAY_SHORT,
  DAY_START,
  MAX_SLOTS,
  addSlot,
  emptyWeek,
  endOptions,
  flattenSlots,
  formatTime,
  groupSlots,
  removeSlot,
  sameWeek,
  startOptions,
  toMinutes,
  validateSlot,
} from "@/components/dashboard/availability";

function TimeSelect({ id, label, value, options, onChange, placeholder }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || null} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder}>
            {(current) => current || placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((time) => (
            <SelectItem key={time} value={time}>
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** "+" button + popover for adding one slot to a day. */
function AddSlotPopover({ day, daySlots, onAdd, disabled }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");

  const starts = useMemo(() => startOptions(daySlots), [daySlots]);
  const ends = useMemo(() => (start ? endOptions(start, daySlots) : []), [start, daySlots]);
  const full = starts.length === 0;

  function handleOpenChange(next) {
    setOpen(next);
    if (next) {
      // Default to the first free start and a one-hour slot (or the longest that fits).
      const first = starts[0] || "";
      const firstEnds = first ? endOptions(first, daySlots) : [];
      setStart(first);
      setEnd(firstEnds[1] || firstEnds[0] || "");
      setError("");
    }
  }

  function handleStart(value) {
    setStart(value);
    const nextEnds = value ? endOptions(value, daySlots) : [];
    if (!nextEnds.includes(end)) setEnd(nextEnds[1] || nextEnds[0] || "");
    setError("");
  }

  function handleAdd() {
    const slot = { start_time: start, end_time: end };
    const problem = validateSlot(slot, daySlots);
    if (problem) {
      setError(problem);
      return;
    }
    onAdd(slot);
    setOpen(false);
  }

  const baseId = `slot-${day.toLowerCase()}`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="soft"
            size="icon-xs"
            className="rounded-full"
            aria-label={full ? `${day} is fully booked` : `Add a slot on ${day}`}
            disabled={disabled || full}
          />
        }
      >
        <Plus aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-72" align="center">
        <PopoverTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" aria-hidden="true" />
          Add {day} slot
        </PopoverTitle>
        <div className="grid grid-cols-2 gap-2">
          <TimeSelect
            id={`${baseId}-start`}
            label="Start"
            value={start}
            options={starts}
            onChange={handleStart}
            placeholder="Start"
          />
          <TimeSelect
            id={`${baseId}-end`}
            label="End"
            value={end}
            options={ends}
            onChange={(v) => {
              setEnd(v);
              setError("");
            }}
            placeholder="End"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="button" size="sm" onClick={handleAdd} disabled={!start || !end}>
          <Plus aria-hidden="true" />
          Add slot
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const WINDOW_START = toMinutes(DAY_START);
const WINDOW_LENGTH = toMinutes(DAY_END) - WINDOW_START;

function slotMinutes(slot) {
  return Math.max(0, toMinutes(slot.end_time) - toMinutes(slot.start_time));
}

function hoursLabel(minutes) {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * Thin 08:00–20:00 track under each day heading; every slot is a primary
 * segment that grows in from the left. Decorative — the chips carry the data.
 */
function DayTimeline({ slots }) {
  return (
    <div aria-hidden="true" className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <AnimatePresence initial={false}>
        {slots.map((slot) => {
          const left = ((toMinutes(slot.start_time) - WINDOW_START) / WINDOW_LENGTH) * 100;
          const width = (slotMinutes(slot) / WINDOW_LENGTH) * 100;
          return (
            <motion.span
              key={`${slot.start_time}-${slot.end_time}`}
              className="absolute inset-y-0 origin-left rounded-full bg-gradient-to-r from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_40%)]"
              style={{ left: `${left}%`, width: `${width}%` }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              exit={{ scaleX: 0, opacity: 0 }}
              transition={SPRING.soft}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Mentor's weekly recurring availability: 7 day columns, "+" opens a popover
 * (30-min steps 08:00–20:00, end after start, no overlaps within a day),
 * chips remove with X, "Save Availability" → POST /calendar/slots.
 * Loads the current slots from GET /calendar/slots/{mentorId}.
 */
export default function AvailabilityGrid({ mentorId }) {
  const [week, setWeek] = useState(emptyWeek);
  const [saved, setSaved] = useState(emptyWeek);
  const [loading, setLoading] = useState(Boolean(mentorId));
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!mentorId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    getMentorSlots(mentorId)
      .then((res) => {
        if (cancelled) return;
        const grouped = groupSlots(res?.slots);
        setWeek(grouped);
        setSaved(grouped);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) {
          setWeek(emptyWeek());
          setSaved(emptyWeek());
        } else {
          setLoadError(err.message || "Could not load your availability.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mentorId, reload]);

  const dirty = !sameWeek(week, saved);
  const total = flattenSlots(week).length;
  const atLimit = total >= MAX_SLOTS;

  function handleAdd(day, slot) {
    setWeek((prev) => {
      try {
        return { ...prev, [day]: addSlot(prev[day], slot) };
      } catch (err) {
        toast.error(err.message);
        return prev;
      }
    });
  }

  function handleRemove(day, index) {
    setWeek((prev) => ({ ...prev, [day]: removeSlot(prev[day], index) }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const flat = flattenSlots(week);
      const res = await saveCalendarSlots(flat);
      const grouped = groupSlots(Array.isArray(res?.slots) ? res.slots : flat);
      setWeek(grouped);
      setSaved(grouped);
      toast.success("Availability saved.");
    } catch (err) {
      if (err?.status !== 0) toast.error(err.message || "Could not save your availability.");
    } finally {
      setSaving(false);
    }
  }

  const totalMinutes = flattenSlots(week).reduce((sum, slot) => sum + slotMinutes(slot), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary"
          >
            <Clock className="size-4" />
          </span>
          Weekly availability
        </CardTitle>
        <CardDescription>
          Recurring slots startups can book. Times are 30-minute steps between 08:00 and 20:00.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!mentorId ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Finish your mentor profile first — availability is attached to your public mentor
              listing.
            </p>
            <Button size="sm" variant="outline" className="shrink-0" render={<Link href="/onboarding/mentor" />}>
              Finish profile
            </Button>
          </div>
        ) : loading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {DAYS.map((d) => (
              <Skeleton key={d} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : loadError ? (
          <InlineError message={loadError}>
            <Button type="button" size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </InlineError>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {DAYS.map((day, dayIndex) => {
                const slots = week[day] || [];
                const active = slots.length > 0;
                return (
                  <motion.section
                    key={day}
                    aria-labelledby={`avail-${day}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING.soft, delay: dayIndex * 0.035 }}
                    className={cn(
                      "flex min-h-32 flex-col gap-2.5 rounded-xl border p-3 transition-colors duration-300",
                      active
                        ? "border-primary/25 bg-primary/[0.06]"
                        : "border-border bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <h4
                        id={`avail-${day}`}
                        className={cn(
                          "font-mono text-[11px] font-semibold uppercase tracking-[0.14em]",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        <span aria-hidden="true">{DAY_SHORT[day]}</span>
                        <span className="sr-only">{day}</span>
                      </h4>
                      <AddSlotPopover
                        day={day}
                        daySlots={slots}
                        onAdd={(slot) => handleAdd(day, slot)}
                        disabled={saving || atLimit}
                      />
                    </div>
                    <DayTimeline slots={slots} />
                    {slots.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/70">No slots</p>
                    ) : (
                      <ul className="relative flex flex-wrap gap-1.5">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {slots.map((slot, i) => (
                            <motion.li
                              key={`${slot.start_time}-${slot.end_time}`}
                              layout
                              initial={{ opacity: 0, scale: 0.6 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.6 }}
                              transition={SPRING.bouncy}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary py-1 pl-2 pr-0.5 font-mono text-[11px] font-medium tabular-nums text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2)]"
                            >
                              {slot.start_time}–{slot.end_time}
                              <button
                                type="button"
                                onClick={() => handleRemove(day, i)}
                                disabled={saving}
                                className="inline-flex rounded-md p-0.5 opacity-70 outline-none transition-opacity hover:bg-primary-foreground/15 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-foreground/60 disabled:opacity-40"
                                aria-label={`Remove ${day} ${formatTime(slot.start_time)} to ${formatTime(slot.end_time)}`}
                              >
                                <X className="size-3" aria-hidden="true" />
                              </button>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </motion.section>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:pl-4">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
                <span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">{total}</span> slot
                  {total === 1 ? "" : "s"} per week
                  {atLimit ? ` (maximum ${MAX_SLOTS})` : ""}
                </span>
                <span aria-hidden="true" className="text-border">|</span>
                <span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {hoursLabel(totalMinutes)}
                  </span>{" "}
                  bookable
                </span>
                <AnimatePresence initial={false}>
                  {dirty && (
                    <motion.span
                      key="dirty"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      className="inline-flex items-center gap-1.5 font-medium text-spark"
                    >
                      <span className="relative flex size-2">
                        <span className="absolute inset-0 rounded-full bg-spark/60 motion-safe:animate-ping" />
                        <span className="relative size-2 rounded-full bg-spark" />
                      </span>
                      <span>
                        <span className="sr-only">· </span>unsaved changes
                      </span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </p>
              <Button type="button" onClick={handleSave} disabled={saving || !dirty} className="w-full sm:w-auto">
                {saving ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {saving ? "Saving…" : "Save Availability"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
