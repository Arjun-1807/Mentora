// Pure, framework-free helpers shared by the dashboards (startup, mentor,
// coordinator). Kept import-free so they can be unit-tested with plain node.

export function statusOf(match) {
  return String(match?.status || "pending").toLowerCase();
}

/** Match score as an integer percentage; accepts 0–1 or 0–100. null if unknown. */
export function scorePercent(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)));
}

export function dateLabel(value, { withTime = false } = {}) {
  if (!value) return "—";
  // A bare "YYYY-MM-DD" is a calendar date, not UTC midnight — parse it as local.
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return withTime
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Two-letter initials from a name or an email address. */
export function initialsOf(value) {
  const text = String(value || "").trim();
  if (!text) return "?";
  const base = text.includes("@") ? text.split("@")[0] : text;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/**
 * When the scheduled meeting ends, as a local Date. Falls back to the end of
 * the day when only a date is known. null if there's no usable date.
 */
export function meetingEnd(meeting) {
  const date = meeting?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = /^\d{1,2}:\d{2}$/.test(meeting?.end_time || "")
    ? meeting.end_time.padStart(5, "0")
    : "23:59";
  const end = new Date(`${date}T${time}:00`);
  return Number.isNaN(end.getTime()) ? null : end;
}

/**
 * Post-meeting banner rule: the meeting is scheduled, it has already ended,
 * and this role hasn't logged a health outcome for it yet.
 */
export function needsHealthLog(match, role, now = new Date()) {
  if (statusOf(match) !== "meeting_scheduled") return false;
  const end = meetingEnd(match?.meeting);
  if (!end || end.getTime() > now.getTime()) return false;
  const loggedBy = Array.isArray(match?.health_logged_by) ? match.health_logged_by : [];
  return !loggedBy.includes(role);
}

/** Marks a match as health-logged by `role` (for optimistic updates). */
export function withHealthLogged(match, role) {
  const loggedBy = Array.isArray(match?.health_logged_by) ? match.health_logged_by : [];
  return loggedBy.includes(role) ? match : { ...match, health_logged_by: [...loggedBy, role] };
}

/** Same match? Compares the uuid `match_id` first, then the Mongo `_id`. */
export function sameMatch(a, b) {
  if (!a || !b) return false;
  if (a.match_id && b.match_id) return a.match_id === b.match_id;
  return Boolean(a._id) && a._id === b._id;
}

/* ------------------------------------------------------------- health / cohort */

export function healthTone(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return "none";
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

/**
 * Cohort sort: by health score ascending (or descending), with nulls (no
 * meeting logged yet) ALWAYS last in either direction — the same order GET
 * /health/cohort returns. Ties broken by email.
 */
export function sortCohort(rows, direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...(rows || [])].sort((a, b) => {
    const aNull = typeof a?.health_score !== "number";
    const bNull = typeof b?.health_score !== "number";
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && a.health_score !== b.health_score) {
      return sign * (a.health_score - b.health_score);
    }
    return String(a?.email || "").localeCompare(String(b?.email || ""));
  });
}

/* ------------------------------------------------------------------------- CSV */

/**
 * One CSV field: quoted when it contains a comma, quote or newline (quotes
 * doubled, RFC 4180). Text that a spreadsheet would run as a formula
 * (= + - @, tab, CR) is prefixed with a single quote; numbers are left alone.
 */
export function csvField(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** rows: array of arrays → CSV text with CRLF line endings. */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

export const COHORT_CSV_HEADER = [
  "Email",
  "Domain",
  "Stage",
  "Health Score",
  "Trend",
  "Matches",
  "Meetings",
  "Last Activity",
];

export function cohortCsv(rows) {
  const body = (rows || []).map((r) => [
    r?.email ?? "",
    r?.domain ?? "",
    r?.stage ?? "",
    typeof r?.health_score === "number" ? Math.round(r.health_score * 10) / 10 : "",
    r?.trend ?? "",
    typeof r?.match_count === "number" ? r.match_count : "",
    typeof r?.meeting_count === "number" ? r.meeting_count : "",
    r?.last_activity ?? "",
  ]);
  return toCsv([COHORT_CSV_HEADER, ...body]);
}
