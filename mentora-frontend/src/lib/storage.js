// Single source of truth for everything Mentora keeps in localStorage.
//
// All reads/writes go through these helpers so the storage keys are declared
// exactly once, every access is guarded for SSR + private-mode failures, and
// writes can notify the rest of the app (see `AUTH_EVENT`).

export const TOKEN_KEY = "token";
export const STARTUP_PROFILE_KEY = "startupProfile";
export const MENTOR_MATCHES_KEY = "mentorMatches";

/** Dispatched on `window` whenever the token changes in this tab. */
export const AUTH_EVENT = "mentora:auth-change";

function read(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota) — degrade silently.
  }
}

function remove(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function readJson(key) {
  const raw = read(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt payload — drop it so we don't keep failing on every read.
    remove(key);
    return null;
  }
}

function emitAuthChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/* ---------------------------------------------------------------- auth token */

export function getToken() {
  return read(TOKEN_KEY);
}

export function setToken(token) {
  if (!token) return;
  write(TOKEN_KEY, token);
  emitAuthChange();
}

export function clearToken() {
  remove(TOKEN_KEY);
  emitAuthChange();
}

/** Clears the token plus any cached per-user data (used on sign out). */
export function clearSession() {
  remove(STARTUP_PROFILE_KEY);
  remove(MENTOR_MATCHES_KEY);
  clearToken();
}

/* ------------------------------------------------------------- cached data */

/** The startup profile extracted from the pitch deck, or `null`. */
export function getStoredProfile() {
  const profile = readJson(STARTUP_PROFILE_KEY);
  return profile && typeof profile === "object" ? profile : null;
}

export function setStoredProfile(profile) {
  write(STARTUP_PROFILE_KEY, JSON.stringify(profile));
}

/** The mentor matches from /match, always normalized to an array. */
export function getStoredMatches() {
  const stored = readJson(MENTOR_MATCHES_KEY);
  if (Array.isArray(stored)) return stored;
  if (stored && Array.isArray(stored.matches)) return stored.matches;
  return null;
}

export function setStoredMatches(matches) {
  write(MENTOR_MATCHES_KEY, JSON.stringify(matches));
}
