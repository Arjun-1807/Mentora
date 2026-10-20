// Pure helpers for the mentor's weekly availability grid. No React, no
// imports, so they can be unit-tested with plain node.
//
// Slots are `{day: "Monday".."Sunday", start_time: "HH:MM", end_time: "HH:MM"}`
// on the wire (POST /calendar/slots). Inside the grid they are grouped by day:
// `{Monday: [{start_time, end_time}], ...}`, each day sorted by start time.

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const DAY_SHORT = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export const DAY_START = "08:00";
export const DAY_END = "20:00";
export const STEP_MINUTES = 30;
/** POST /calendar/slots accepts at most this many slots per week. */
export const MAX_SLOTS = 100;

/** "HH:MM" → minutes since midnight, or NaN when malformed. */
export function toMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

/** minutes since midnight → zero-padded "HH:MM". */
export function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Normalises "9:00" → "09:00"; returns null for anything unparseable. */
export function normalizeTime(time) {
  const minutes = toMinutes(time);
  return Number.isNaN(minutes) ? null : fromMinutes(minutes);
}

/** Every selectable time, 08:00 … 20:00 in 30-minute steps (25 values). */
export function timeOptions() {
  const out = [];
  for (let t = toMinutes(DAY_START); t <= toMinutes(DAY_END); t += STEP_MINUTES) {
    out.push(fromMinutes(t));
  }
  return out;
}

/** "13:30" → "1:30 PM" for display. */
export function formatTime(time) {
  const minutes = toMinutes(time);
  if (Number.isNaN(minutes)) return String(time ?? "");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** True when two half-open ranges [start, end) share any time. Touching is fine. */
export function overlaps(a, b) {
  const aStart = toMinutes(a.start_time);
  const aEnd = toMinutes(a.end_time);
  const bStart = toMinutes(b.start_time);
  const bEnd = toMinutes(b.end_time);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Start times that can still begin a slot on a day: inside the 08:00–20:00
 * window, not inside an existing slot, and leaving room for at least one step
 * before the next slot / end of day.
 */
export function startOptions(daySlots = []) {
  return timeOptions().filter((time) => endOptions(time, daySlots).length > 0);
}

/**
 * Valid end times for a slot starting at `start`: strictly after it, no later
 * than 20:00, and no later than the start of the next existing slot.
 */
export function endOptions(start, daySlots = []) {
  const startMin = toMinutes(start);
  if (Number.isNaN(startMin)) return [];
  // A start that falls inside an existing slot can't be used at all.
  const inside = daySlots.some(
    (s) => toMinutes(s.start_time) <= startMin && startMin < toMinutes(s.end_time)
  );
  if (inside) return [];

  let limit = toMinutes(DAY_END);
  for (const slot of daySlots) {
    const s = toMinutes(slot.start_time);
    if (s >= startMin && s < limit) limit = s;
  }
  return timeOptions().filter((time) => {
    const t = toMinutes(time);
    return t > startMin && t <= limit;
  });
}

/** Returns a user-facing error for a proposed slot, or null when it's valid. */
export function validateSlot(slot, daySlots = []) {
  const start = toMinutes(slot?.start_time);
  const end = toMinutes(slot?.end_time);
  if (Number.isNaN(start) || Number.isNaN(end)) return "Pick a start and end time.";
  if (start < toMinutes(DAY_START) || end > toMinutes(DAY_END)) {
    return "Slots must fall between 8:00 AM and 8:00 PM.";
  }
  if (start % STEP_MINUTES !== 0 || end % STEP_MINUTES !== 0) {
    return "Times must be on the hour or half hour.";
  }
  if (end <= start) return "End time must be after the start time.";
  if (daySlots.some((existing) => overlaps(existing, slot))) {
    return "That overlaps a slot you already added for this day.";
  }
  return null;
}

function byStart(a, b) {
  return toMinutes(a.start_time) - toMinutes(b.start_time);
}

/** Adds a slot to a day's list (sorted). Throws if it's invalid. */
export function addSlot(daySlots = [], slot) {
  const error = validateSlot(slot, daySlots);
  if (error) throw new Error(error);
  return [...daySlots, { start_time: slot.start_time, end_time: slot.end_time }].sort(byStart);
}

/** Removes the slot at `index` from a day's list. */
export function removeSlot(daySlots = [], index) {
  return daySlots.filter((_, i) => i !== index);
}

/** Matches "monday", "Mon", "MONDAY" … to the canonical day name. */
export function canonicalDay(day) {
  const value = String(day ?? "").trim().toLowerCase();
  if (!value) return null;
  return DAYS.find((d) => d.toLowerCase() === value || d.slice(0, 3).toLowerCase() === value) || null;
}

/** An empty `{Monday: [], …, Sunday: []}` map. */
export function emptyWeek() {
  return Object.fromEntries(DAYS.map((d) => [d, []]));
}

/**
 * Wire format → grouped map. Drops malformed entries and anything that
 * overlaps an earlier slot on the same day, so the grid never starts invalid.
 */
export function groupSlots(slots) {
  const week = emptyWeek();
  if (!Array.isArray(slots)) return week;
  const candidates = slots
    .map((s) => ({
      day: canonicalDay(s?.day),
      start_time: normalizeTime(s?.start_time),
      end_time: normalizeTime(s?.end_time),
    }))
    .filter((s) => s.day && s.start_time && s.end_time)
    .sort(byStart);

  for (const slot of candidates) {
    if (toMinutes(slot.end_time) <= toMinutes(slot.start_time)) continue;
    if (week[slot.day].some((existing) => overlaps(existing, slot))) continue;
    week[slot.day].push({ start_time: slot.start_time, end_time: slot.end_time });
  }
  for (const day of DAYS) week[day].sort(byStart);
  return week;
}

/** Grouped map → wire format, Monday first, each day sorted by start time. */
export function flattenSlots(week) {
  const out = [];
  for (const day of DAYS) {
    const list = Array.isArray(week?.[day]) ? [...week[day]].sort(byStart) : [];
    for (const slot of list) {
      out.push({ day, start_time: slot.start_time, end_time: slot.end_time });
    }
  }
  return out;
}

/** Order-insensitive equality of two grouped weeks (for "unsaved changes"). */
export function sameWeek(a, b) {
  return JSON.stringify(flattenSlots(a)) === JSON.stringify(flattenSlots(b));
}
