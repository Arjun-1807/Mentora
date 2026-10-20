"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/StateCard";
import { getMentorSlots, saveCalendarSlots } from "@/lib/api";
import {
  DAYS,
  DAY_SHORT,
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
            variant="ghost"
            size="icon-sm"
            aria-label={full ? `${day} is fully booked` : `Add a slot on ${day}`}
            disabled={disabled || full}
          />
        }
      >
        <Plus aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-64" align="center">
        <PopoverTitle>Add {day} slot</PopoverTitle>
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
          Add
        </Button>
      </PopoverContent>
    </Popover>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          Weekly availability
        </CardTitle>
        <CardDescription>
          Recurring slots startups can book. Times are 30-minute steps between 08:00 and 20:00.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!mentorId ? (
          <p className="text-sm text-muted-foreground">
            Finish your mentor profile first — availability is attached to your public mentor listing.
          </p>
        ) : loading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {DAYS.map((d) => (
              <Skeleton key={d} className="h-28 w-full" />
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
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {DAYS.map((day) => {
                const slots = week[day] || [];
                return (
                  <section
                    key={day}
                    aria-labelledby={`avail-${day}`}
                    className="flex min-h-28 flex-col rounded-lg border border-border bg-muted/30 p-2"
                  >
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <h4 id={`avail-${day}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                    {slots.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/70">No slots</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {slots.map((slot, i) => (
                          <li
                            key={`${slot.start_time}-${slot.end_time}`}
                            className="inline-flex items-center gap-1 rounded-md bg-primary/15 py-0.5 pl-2 pr-0.5 text-[11px] font-medium tabular-nums text-primary"
                          >
                            {slot.start_time}–{slot.end_time}
                            <button
                              type="button"
                              onClick={() => handleRemove(day, i)}
                              disabled={saving}
                              className="inline-flex rounded p-0.5 outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
                              aria-label={`Remove ${day} ${formatTime(slot.start_time)} to ${formatTime(slot.end_time)}`}
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {total} slot{total === 1 ? "" : "s"} per week
                {atLimit ? ` (maximum ${MAX_SLOTS})` : ""}
                {dirty ? " · unsaved changes" : ""}
              </p>
              <Button type="button" onClick={handleSave} disabled={saving || !dirty}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {saving ? "Saving…" : "Save Availability"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
