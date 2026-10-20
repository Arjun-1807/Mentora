// Pure helpers for the "Book a Meeting" panel. No React / Next imports, so the
// logic can be exercised with plain Node.

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function pad(n) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for a Date, in the browser's local timezone. */
export function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minutes since midnight for "HH:MM", or null when malformed. */
export function timeToMinutes(value) {
  const m = TIME_RE.exec(String(value || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Normalises "9:00" → "09:00". Returns null when malformed. */
function normaliseTime(value) {
  const mins = timeToMinutes(value);
  if (mins === null) return null;
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** Case-insensitive day name ("monday", "Mon") → canonical "Monday", or null. */
function normaliseDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  return DAY_NAMES.find((d) => d.toLowerCase() === raw || d.toLowerCase().slice(0, 3) === raw) || null;
}

/**
 * Expands a mentor's weekly recurring availability into concrete bookable
 * dates for the next `days` days (today included).
 *
 * @param {Array<{day:string,start_time:string,end_time:string}>} weeklySlots
 * @param {Date} [now]  reference "now" (injectable for tests)
 * @param {number} [days]
 * @returns {Array<{date:string, dayName:string, slots:Array<{start_time:string,end_time:string}>}>}
 *   Only dates with at least one slot are returned, in chronological order;
 *   each date's slots are sorted by start time and de-duplicated. Slots on
 *   today's date whose start time has already passed are skipped, as are
 *   malformed windows (bad time, or end <= start).
 */
export function generateUpcomingSlots(weeklySlots, now = new Date(), days = 14) {
  if (!Array.isArray(weeklySlots) || weeklySlots.length === 0) return [];

  const byDay = new Map();
  for (const slot of weeklySlots) {
    const day = normaliseDay(slot?.day);
    const start = normaliseTime(slot?.start_time);
    const end = normaliseTime(slot?.end_time);
    if (!day || !start || !end) continue;
    if (timeToMinutes(end) <= timeToMinutes(start)) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ start_time: start, end_time: end });
  }
  if (byDay.size === 0) return [];

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const result = [];

  for (let offset = 0; offset < days; offset += 1) {
    // Build each date from calendar fields (not +24h) so DST shifts can't skip a day.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dayName = DAY_NAMES[date.getDay()];
    const windows = byDay.get(dayName);
    if (!windows) continue;

    const seen = new Set();
    const slots = windows
      .filter((w) => offset > 0 || timeToMinutes(w.start_time) > nowMinutes)
      .filter((w) => {
        const key = `${w.start_time}-${w.end_time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    if (slots.length > 0) result.push({ date: toIsoDate(date), dayName, slots });
  }

  return result;
}

/** "2026-10-19" → Date at local midnight (avoids the UTC parse of `new Date(iso)`). */
export function parseIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "Mon, 19 Oct" style label for a date chip. */
export function formatDateChip(iso) {
  const date = parseIsoDate(iso);
  if (!date) return String(iso || "");
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "Monday, 19 October 2026" style label for the meeting card. */
export function formatLongDate(iso) {
  const date = parseIsoDate(iso);
  if (!date) return String(iso || "");
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "09:00–10:00" (en dash). */
export function formatSlotWindow(slot) {
  if (!slot) return "";
  return `${slot.start_time}–${slot.end_time}`;
}
