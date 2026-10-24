"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { toast } from "sonner";
import {
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronDown,
  Clock,
  Loader2,
} from "lucide-react";
import { SPRING } from "@/components/motion";
import { InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { bookMeeting, getMentorSlots } from "@/lib/api";
import { cn } from "@/lib/utils";
import MeetingCard from "@/components/matches/MeetingCard";
import {
  formatDateChip,
  formatSlotWindow,
  generateUpcomingSlots,
  parseIsoDate,
} from "@/components/matches/slots";

const MAX_DESCRIPTION = 500;

/**
 * Selectable chip. The selected background is a shared `layoutId` element, so
 * it slides from the previous choice to the new one (namespaced per booking
 * panel by the surrounding <LayoutGroup id>).
 */
function Chip({ selected, onClick, layoutId, className, children }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      whileTap={{ scale: 0.95 }}
      transition={SPRING.snappy}
      className={cn(
        "relative shrink-0 rounded-xl border px-3 py-1.5 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
        className
      )}
    >
      {selected && (
        <motion.span
          layoutId={layoutId}
          transition={SPRING.snappy}
          aria-hidden="true"
          className="absolute inset-[-1px] rounded-[inherit] bg-primary shadow-glow"
        />
      )}
      <span className="relative">{children}</span>
    </motion.button>
  );
}

function DateChipLabel({ iso }) {
  const date = parseIsoDate(iso);
  if (!date) return formatDateChip(iso);
  return (
    <span className="flex flex-col items-center leading-tight" aria-hidden="true">
      <span className="text-[10px] font-medium uppercase tracking-wider opacity-75">
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span className="text-lg font-semibold tabular-nums">{date.getDate()}</span>
      <span className="text-[10px] opacity-75">
        {date.toLocaleDateString(undefined, { month: "short" })}
      </span>
    </span>
  );
}

/**
 * Collapsible "Book a Meeting" panel shown under an accepted match. Expands
 * the mentor's weekly slots into the next 14 days, lets the founder pick a
 * date + time window, and books it via POST /calendar/book.
 */
export default function BookingSection({ match, onBooked }) {
  const router = useRouter();
  const panelId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  // Which `reloadKey` the current `days` were fetched for (-1 = never).
  const [loadedKey, setLoadedKey] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [description, setDescription] = useState("");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const mentorName = match?.name || "this mentor";

  // Fetch lazily the first time the panel opens (and on retry).
  useEffect(() => {
    if (!open || loadedKey === reloadKey || !match?.mentor_id) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    getMentorSlots(match.mentor_id)
      .then((data) => {
        if (cancelled) return;
        const weekly = Array.isArray(data) ? data : data?.slots || [];
        const upcoming = generateUpcomingSlots(weekly, new Date(), 14);
        setDays(upcoming);
        setSelectedDate(upcoming[0]?.date ?? null);
        setSelectedSlot(null);
        setLoadedKey(reloadKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || "Couldn't load this mentor's availability.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `loadedKey` is intentionally read, not tracked: fetch once per open/retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reloadKey, match?.mentor_id]);

  const selectedDay = useMemo(
    () => days.find((d) => d.date === selectedDate) || null,
    [days, selectedDate]
  );

  function chooseDate(date) {
    setSelectedDate(date);
    setSelectedSlot(null);
  }

  async function handleConfirm() {
    if (!selectedDate || !selectedSlot || booking) return;
    setBooking(true);
    const slot = {
      date: selectedDate,
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
    };
    try {
      const res = await bookMeeting({
        mentor_id: match.mentor_id,
        match_id: match.match_id,
        slot,
        description: description.trim(),
      });
      const meeting = {
        ...slot,
        event_id: res?.event_id ?? null,
        meet_link: res?.meet_link ?? null,
        html_link: res?.html_link ?? null,
        title: res?.title ?? null,
      };
      setBooked(meeting);
      toast.success(`Meeting booked with ${mentorName}`);
      onBooked?.(match, meeting);
    } catch (err) {
      if (err.status === 403 && err.payload?.error === "calendar_not_connected") {
        if (err.payload?.user === "startup") {
          toast.error("Connect your Google Calendar first to book meetings.", {
            description: "You can connect it from your dashboard.",
            action: { label: "Go to dashboard", onClick: () => router.push("/dashboard") },
          });
        } else {
          toast.error("Mentor hasn't connected their calendar yet. Email them instead.");
        }
      } else if (err.status !== 0) {
        // Network failures already raised the "Server unavailable" toast.
        toast.error(err.message || "Couldn't book that slot. Please try another time.");
      }
    } finally {
      setBooking(false);
    }
  }

  if (booked) {
    return (
      <div className="mt-4">
        <MeetingCard meeting={booked} mentorName={mentorName} />
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <CalendarClock className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">Book a Meeting</span>
            <span className="block text-xs text-muted-foreground">
              {mentorName} accepted — pick a time that works.
            </span>
          </span>
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={SPRING.snappy}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <LayoutGroup id={panelId}>
              <div className="space-y-5 border-t border-border px-4 pb-4 pt-5">
                {loading ? (
                  <div className="space-y-3" role="status" aria-live="polite">
                    <span className="sr-only">Loading availability</span>
                    <div className="flex gap-2 overflow-hidden">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-[68px] w-14 shrink-0 rounded-xl" />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-28 rounded-xl" />
                      ))}
                    </div>
                  </div>
                ) : loadError ? (
                  <InlineError message={loadError}>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                      Try again
                    </Button>
                  </InlineError>
                ) : days.length === 0 ? (
                  <p className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                    <CalendarX2 className="size-4 shrink-0" aria-hidden="true" />
                    This mentor hasn&apos;t published availability yet.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2.5">
                      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Pick a date
                      </p>
                      <div
                        role="group"
                        aria-label="Available dates in the next 14 days"
                        className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1 sm:flex-wrap sm:overflow-visible"
                      >
                        {days.map((d) => (
                          <Chip
                            key={d.date}
                            layoutId="booking-date"
                            selected={d.date === selectedDate}
                            onClick={() => chooseDate(d.date)}
                            className="w-14 px-0 py-2"
                          >
                            <DateChipLabel iso={d.date} />
                            <span className="sr-only">
                              {`${formatDateChip(d.date)}, ${d.slots.length} time${d.slots.length === 1 ? "" : "s"} available`}
                            </span>
                          </Chip>
                        ))}
                      </div>
                    </div>

                    <AnimatePresence mode="wait" initial={false}>
                      {selectedDay && (
                        <motion.div
                          key={selectedDay.date}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-2.5"
                        >
                          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            Pick a time
                          </p>
                          <div
                            role="group"
                            aria-label={`Times on ${selectedDay.dayName}`}
                            className="flex flex-wrap gap-2"
                          >
                            {selectedDay.slots.map((s) => {
                              const key = `${s.start_time}-${s.end_time}`;
                              const isSelected =
                                selectedSlot?.start_time === s.start_time &&
                                selectedSlot?.end_time === s.end_time;
                              return (
                                <Chip
                                  key={key}
                                  layoutId="booking-time"
                                  selected={isSelected}
                                  onClick={() => setSelectedSlot(s)}
                                >
                                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                                    <Clock className="size-3.5" aria-hidden="true" />
                                    {formatSlotWindow(s)}
                                  </span>
                                </Chip>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="space-y-1.5">
                      <Label htmlFor={descriptionId}>
                        What would you like to discuss? <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Textarea
                        id={descriptionId}
                        rows={3}
                        maxLength={MAX_DESCRIPTION}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="e.g. Go-to-market plan for our first enterprise pilot"
                        disabled={booking}
                      />
                      <p className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {description.length}/{MAX_DESCRIPTION}
                      </p>
                    </div>

                    <div className="flex flex-col-reverse gap-3 rounded-xl bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground" aria-live="polite">
                        {selectedSlot && selectedDay ? (
                          <span className="font-medium text-foreground">
                            {`${formatDateChip(selectedDay.date)} · ${formatSlotWindow(selectedSlot)}`}
                          </span>
                        ) : (
                          "Choose a time to continue."
                        )}
                      </p>
                      <Button type="button" onClick={handleConfirm} disabled={!selectedSlot || booking}>
                        {booking ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <CalendarCheck2 aria-hidden="true" />
                        )}
                        {booking ? "Booking…" : "Confirm Booking"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
