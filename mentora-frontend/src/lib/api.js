// Single source of truth for all backend API calls.
export const API_BASE_URL = "http://localhost:8000";

function getToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("token");
  } catch {
    return null;
  }
}

/**
 * Clears the auth token and sends the user back to /login.
 * Exposed so pages can call it directly (e.g. from a guarded route).
 */
export function forceLogout() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("token");
  } catch {
    // ignore
  }
  window.location.href = "/login";
}

async function request(path, { method = "GET", body, isFormData = false, skipAuth = false } = {}) {
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

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (res.status === 401) {
    forceLogout();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) message = data.detail;
      else if (data?.message) message = data.message;
    } catch {
      // response wasn't JSON, keep the default message
    }
    throw new Error(message);
  }

  if (res.status === 204) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
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

/** Generates an intro email for a startup/mentor pair. */
export function sendEmail(startupProfile, mentor) {
  return request("/email", {
    method: "POST",
    body: { startup_profile: startupProfile, mentor },
  });
}

/** Logs the outcome (attendance + rating) of a mentor match. */
export function logFeedback(payload) {
  return request("/feedback", { method: "POST", body: payload });
}

/** Fetches every match document, for the dashboard. */
export function getAllMatches() {
  return request("/matches/all", { method: "GET" });
}

/** Logs a user in, returns a JWT. */
export function login(email, password) {
  return request("/login", {
    method: "POST",
    body: { email, password },
    skipAuth: true,
  });
}

/** Registers a new user (startup or mentor), returns a JWT. */
export function register(payload) {
  return request("/register", { method: "POST", body: payload, skipAuth: true });
}
