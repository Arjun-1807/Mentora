// Single source of truth for all backend API calls.
import { clearToken, getToken } from "@/lib/storage";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/** Error thrown by every failed request; carries the HTTP status. */
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
    throw new ApiError(
      "Could not reach the Mentora server. Check your connection and try again.",
      0
    );
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
 * Nothing is delivered here — the response is a draft the founder sends from
 * their own mail client. When `matchId` is supplied the backend also advances
 * that match's lifecycle to `emailed`, which is what the dashboard reports.
 */
export function draftIntroEmail(startupProfile, mentor, matchId) {
  const body = { startup_profile: startupProfile, mentor };
  if (matchId) body.match_id = matchId;
  return request("/email", { method: "POST", body });
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

/** Registers a new user (startup or mentor), returns a JWT. */
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
