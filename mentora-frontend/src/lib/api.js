// Single source of truth for all backend API calls.
import { toast } from "sonner";
import {
  clearToken,
  getToken,
  roleFromToken,
  setToken,
  setUserEmail,
  setUserRole,
} from "@/lib/storage";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/** Shown (once, de-duplicated) whenever the backend can't be reached at all. */
export const SERVER_UNAVAILABLE_MESSAGE = "Server unavailable. Please try again shortly.";

/** Error thrown by every failed request; carries the HTTP status (0 = network). */
export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

let logoutPending = false;

/**
 * Clears the auth token and sends the user back to /login.
 *
 * The navigation is deferred to a macrotask so this is safe to call from
 * inside a fetch handler that resolves mid-render, and it is de-duplicated so
 * several parallel 401s don't fight over the location.
 */
export function forceLogout({ redirect = true } = {}) {
  clearToken();
  if (!redirect || typeof window === "undefined" || logoutPending) return;

  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/register" || pathname === "/") return;
  if (pathname.startsWith("/join/")) return;

  logoutPending = true;
  setTimeout(() => {
    const next = encodeURIComponent(`${pathname}${search || ""}`);
    window.location.assign(`/login?next=${next}`);
  }, 0);
}

/** Pulls the most useful human-readable message out of an error response. */
function messageFromPayload(payload, status) {
  const detail = payload?.detail ?? payload?.message ?? payload?.error;

  if (typeof detail === "string" && detail.trim()) return detail.trim();

  // FastAPI validation errors: detail is a list of {loc, msg, type}.
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        const field = Array.isArray(item?.loc) ? item.loc.at(-1) : null;
        return item?.msg ? (field ? `${field}: ${item.msg}` : item.msg) : null;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }

  if (detail && typeof detail === "object" && typeof detail.msg === "string") {
    return detail.msg;
  }

  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "Not found.";
  if (status === 409) return "Account already exists.";
  if (status === 413) return "That file is too large.";
  if (status >= 500) return "The server hit an error. Please try again.";
  return `Request failed with status ${status}`;
}

async function request(
  path,
  { method = "GET", body, isFormData = false, skipAuth = false, redirectOn401 = true } = {}
) {
  const headers = {};
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch {
    // Network failure / backend down. Toast here, once, so every caller gets
    // the same feedback; the fixed id stops parallel requests stacking toasts.
    if (typeof window !== "undefined") {
      toast.error(SERVER_UNAVAILABLE_MESSAGE, { id: "server-unavailable" });
    }
    throw new ApiError(SERVER_UNAVAILABLE_MESSAGE, 0);
  }

  if (res.ok) {
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Response wasn't JSON — fall back to a status-derived message.
  }

  if (res.status === 401) {
    forceLogout({ redirect: redirectOn401 });
  }

  throw new ApiError(messageFromPayload(payload, res.status), res.status, payload);
}

/** Uploads a pitch deck PDF and gets back the extracted startup profile. */
export function extractPitchDeck(file) {
  const formData = new FormData();
  formData.append("file", file);
  return request("/extract", { method: "POST", body: formData, isFormData: true });
}

/** Sends a startup profile and gets back ranked mentor matches. */
export function matchMentors(profile) {
  return request("/match", { method: "POST", body: profile });
}

/**
 * Asks the backend to draft an intro email for a startup/mentor pair.
 *
 * Nothing is delivered here — delivery goes through `sendEmail` once the
 * founder has reviewed the draft. When `matchId` is supplied the backend also
 * advances that match's lifecycle to `emailed`.
 */
export function draftIntroEmail(startupProfile, mentor, matchId) {
  const body = { startup_profile: startupProfile, mentor };
  if (matchId) body.match_id = matchId;
  return request("/email", { method: "POST", body });
}

/**
 * Delivers an email through the Next.js `/api/send-email` route (Resend).
 *
 * That route lives on the frontend origin, not the FastAPI backend, but it
 * checks the same bearer token (against `/me`) so it can't be used as an
 * open relay.
 */
export async function sendEmail({ to, subject, body }) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch("/api/send-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ to, subject, body }),
    });
  } catch {
    toast.error(SERVER_UNAVAILABLE_MESSAGE, { id: "server-unavailable" });
    throw new ApiError(SERVER_UNAVAILABLE_MESSAGE, 0);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore — handled below
  }
  if (!res.ok) {
    throw new ApiError(messageFromPayload(payload, res.status), res.status, payload);
  }
  return payload;
}

/**
 * Advances a match's lifecycle status (`emailed` or `email_sent`).
 * The backend only ever moves a match forwards, so this is safe to repeat.
 */
export function updateMatchStatus(matchId, status) {
  return request("/feedback-status", {
    method: "POST",
    body: { match_id: matchId, status },
  });
}

/** Saves the mentor onboarding profile (re-embeds it for matching). */
export function updateMentorProfile(profile) {
  return request("/mentor/profile", { method: "PATCH", body: profile });
}

/** Runs the retrieval evaluation (Precision@5, Recall@5, MRR, NDCG@5…). */
export function runEvaluation(startupProfile, groundTruthMentorIds) {
  return request("/evaluate", {
    method: "POST",
    body: {
      startup_profile: startupProfile,
      ground_truth_mentor_ids: groundTruthMentorIds,
    },
  });
}

/** Logs the outcome (attendance + rating) of a mentor match. */
export function logFeedback(payload) {
  return request("/feedback", { method: "POST", body: payload });
}

/**
 * Fetches the current user's match documents, for the dashboard.
 *
 * The endpoint is a POST today (it predates being a plain read); accept a
 * GET-only deployment too rather than breaking on a method change.
 */
export async function getAllMatches() {
  try {
    return await request("/matches/all", { method: "POST" });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      return request("/matches/all", { method: "GET" });
    }
    throw err;
  }
}

/**
 * Per-mentor aggregate feedback stats (`{mentors: [...]}`).
 * Optional endpoint — callers must tolerate a rejection.
 */
export function getFeedbackSummary() {
  return request("/feedback/summary", { method: "GET" });
}

/**
 * Mentor directory (`{mentors: [...], total}`), used to resolve mentor names.
 * Optional endpoint — callers must tolerate a rejection.
 */
export function listMentors({ limit = 200 } = {}) {
  return request(`/mentors?limit=${encodeURIComponent(limit)}`, { method: "GET" });
}

/**
 * Returns the signed-in user as `{id, email, role, profile}`.
 *
 * Optional endpoint: callers must tolerate a rejection (it may not be
 * deployed yet) and degrade to a generic account UI.
 */
export function getMe() {
  return request("/me", { method: "GET" });
}

/** Logs a user in, returns a JWT. */
export function login(email, password) {
  return request("/login", {
    method: "POST",
    body: { email, password },
    skipAuth: true,
    redirectOn401: false,
  });
}

/**
 * Registers a new user, returns a JWT. Pass `invite_token` (from a
 * /join/<token> link) to join that invite's org/cohort; coordinators can
 * only register with a coordinator invite.
 */
export function register(payload) {
  return request("/register", {
    method: "POST",
    body: payload,
    skipAuth: true,
    redirectOn401: false,
  });
}

/** Pulls the JWT out of whichever field the backend used. */
export function tokenFromAuthResponse(data) {
  return data?.access_token || data?.token || data?.jwt || null;
}

/**
 * Persists a fresh login/register response: `token`, `userRole` and
 * `userEmail` in localStorage. The role comes from the JWT's `role` claim,
 * then `fallbackRole`, then GET /me. Resolves to `{token, role}`, or `null`
 * when the response carried no token.
 */
export async function startSession(data, { email, fallbackRole } = {}) {
  const token = tokenFromAuthResponse(data);
  if (!token) return null;
  let role = roleFromToken(token) || fallbackRole || null;
  if (email) setUserEmail(email);
  if (role) setUserRole(role);
  // Written last: it fires the auth-change event, and listeners (navbar)
  // should already see the role/email.
  setToken(token);
  if (!role) {
    try {
      const me = await getMe();
      role = me?.role || null;
      if (role) setUserRole(role);
      if (me?.email) setUserEmail(me.email);
    } catch {
      // Not fatal: the caller falls back to the startup home.
    }
  }
  return { token, role };
}

/**
 * Fetches the mentor's own incoming match requests.
 * Query param `status` is optional comma-separated filter e.g. "accepted,met".
 */
export function getMentorMatches({ status } = {}) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/mentor/matches${qs}`, { method: "GET" });
}

/**
 * Accepts or declines a specific match request (mentor side).
 * status must be "accepted" | "declined".
 */
export function updateMentorMatchStatus(matchId, status) {
  return request(`/mentor/matches/${encodeURIComponent(matchId)}`, {
    method: "PATCH",
    body: { status },
  });
}

/* ------------------------------------------------------------- dashboards */

/** Startup dashboard counters: `{total_matches, emails_sent, meetings_accepted, avg_rating}`. */
export function getDashboardStats() {
  return request("/dashboard/stats", { method: "GET" });
}

/** Mentor dashboard counters: `{pending_requests, accepted, avg_rating, total_helped}`. */
export function getMentorStats() {
  return request("/mentor/stats", { method: "GET" });
}

/* -------------------------------------------------------- google calendar */

/** Returns `{auth_url}` — send the browser there to start Google OAuth. */
export function getCalendarAuthUrl() {
  return request("/calendar/auth-url", { method: "GET" });
}

/**
 * Completes Google OAuth with the `code` + `state` Google appended to the
 * redirect URL. No auth header needed (the state ties it to the user).
 * Resolves to `{success: true, role}`.
 */
export function submitCalendarCallback(code, state) {
  return request("/calendar/callback", {
    method: "POST",
    body: { code, state },
    skipAuth: true,
    redirectOn401: false,
  });
}

/** `{connected: bool}` for the signed-in user. */
export function getCalendarStatus() {
  return request("/calendar/status", { method: "GET" });
}

/**
 * Saves the mentor's weekly availability.
 * `slots` = `[{day: "Monday".."Sunday", start_time: "HH:MM", end_time: "HH:MM"}]`.
 */
export function saveCalendarSlots(slots) {
  return request("/calendar/slots", { method: "POST", body: { slots } });
}

/** A mentor's weekly availability (`{slots: [...]}`); `mentorId` is the mentors-collection id. */
export function getMentorSlots(mentorId) {
  return request(`/calendar/slots/${encodeURIComponent(mentorId)}`, {
    method: "GET",
    skipAuth: true,
  });
}

/**
 * Books a Google Calendar meeting with a mentor (startup only).
 * `match_id` is the uuid `match_id` from /match, `slot` = `{date, start_time, end_time}`.
 * Resolves to `{success, event_id, meet_link, html_link, title, start, end}`.
 *
 * When either side hasn't connected Google Calendar the backend answers 403
 * with `{error: "calendar_not_connected", user: "startup"|"mentor"}`; that
 * body is on the thrown `ApiError.payload`, and `err.code`/`err.user` are set
 * as shortcuts so callers can branch without digging.
 */
export async function bookMeeting({ mentor_id, match_id, slot, description }) {
  try {
    return await request("/calendar/book", {
      method: "POST",
      body: { mentor_id, match_id, slot, description: description ?? "" },
    });
  } catch (err) {
    if (err instanceof ApiError && err.payload && typeof err.payload === "object") {
      err.code = err.payload.error ?? null;
      err.user = err.payload.user ?? null;
    }
    throw err;
  }
}

/** True when an error from `bookMeeting` means a calendar isn't connected. */
export function isCalendarNotConnected(err) {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.payload?.error === "calendar_not_connected" || err.code === "calendar_not_connected")
  );
}

/* ----------------------------------------------------------- health score */

/**
 * Logs a post-meeting outcome:
 * `{match_id, momentum_score: 1-5, blockers_resolved: bool, mentor_engagement: 1-5, notes?}`.
 * Resolves to `{health_score, trend}`.
 */
export function logHealth(payload) {
  return request("/health/log", { method: "POST", body: payload });
}

/**
 * Health score for a startup (`"me"` = the caller):
 * `{health_score|null, trend, health_history: [{score, timestamp}], last_updated|null}`.
 */
export function getHealth(startupId = "me") {
  return request(`/health/${encodeURIComponent(startupId || "me")}`, { method: "GET" });
}

/** Coordinator view of the startups in their cohorts: `{startups: [...]}`. */
export function getCohortHealth() {
  return request("/health/cohort", { method: "GET" });
}

/* ---------------------------------------------------------------- tenancy */

/**
 * Public preview of an invite for the /join page:
 * `{org_name, org_slug, cohort_name, role, email|null, mentor_name|null, expires_at}`.
 * Rejects with status 404 (unknown) or 410 (revoked / expired / used up).
 */
export function getInvitePreview(token) {
  return request(`/invites/${encodeURIComponent(token)}`, {
    method: "GET",
    skipAuth: true,
    redirectOn401: false,
  });
}

/** The caller's org and cohorts: `{org: {org_id, slug, name, timezone}, cohorts: [{cohort_id, name, status}]}`. */
export function getMyOrg() {
  return request("/orgs/me", { method: "GET" });
}

/** Invites of one of the coordinator's cohorts, newest first: `{invites: [...]}`. */
export function listCohortInvites(cohortId) {
  return request(`/cohorts/${encodeURIComponent(cohortId)}/invites`, { method: "GET" });
}

/**
 * Creates an invite into a cohort (coordinator only).
 * `{role: "startup"}` -> multi-use cohort link; `{role: "mentor", email, mentor_id?}`
 * and `{role: "coordinator", email}` -> single-use, bound to that email.
 * Resolves to the invite plus its one-time `token` and `url`.
 */
export function createCohortInvite(cohortId, payload) {
  return request(`/cohorts/${encodeURIComponent(cohortId)}/invites`, {
    method: "POST",
    body: payload,
  });
}

/** Revokes an invite (idempotent); resolves to the updated invite. */
export function revokeInvite(inviteId) {
  return request(`/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

/** The shareable join link for a raw invite token, on this frontend's origin. */
export function joinUrl(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/join/${encodeURIComponent(token)}`;
}
