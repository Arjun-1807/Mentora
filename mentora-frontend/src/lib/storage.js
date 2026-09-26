// Single source of truth for everything Mentora keeps in localStorage.
//
// All reads/writes go through these helpers so the storage keys are declared
// exactly once, every access is guarded for SSR + private-mode failures, and
// writes can notify the rest of the app (see `AUTH_EVENT`).

export const TOKEN_KEY = "token";
export const USER_ROLE_KEY = "userRole";
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

/** Reads the stored role ("startup" | "mentor") or null. */
export function getUserRole() {
  return read(USER_ROLE_KEY);
}

/** Persists the role so other tabs / page loads know it without decoding the JWT. */
export function setUserRole(role) {
  if (role) write(USER_ROLE_KEY, role);
}

/** Clears the token plus any cached per-user data (used on sign out). */
export function clearSession() {
  remove(STARTUP_PROFILE_KEY);
  remove(MENTOR_MATCHES_KEY);
  remove(USER_ROLE_KEY);
  clearToken();
}

/* ------------------------------------------------------------- cached data */

/**
 * True for an object shaped like the backend's StartupProfile: a non-empty
 * `domain`/`stage` string and (when present) array-valued lists.
 */
export function isValidProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  if (typeof profile.domain !== "string" || !profile.domain.trim()) return false;
  if (typeof profile.stage !== "string" || !profile.stage.trim()) return false;
  for (const key of ["challenges", "team_gaps"]) {
    if (profile[key] !== undefined && !Array.isArray(profile[key])) return false;
  }
  return true;
}

/** The startup profile extracted from the pitch deck, or `null` if missing/malformed. */
export function getStoredProfile() {
  const profile = readJson(STARTUP_PROFILE_KEY);
  return isValidProfile(profile) ? profile : null;
}

export function setStoredProfile(profile) {
  write(STARTUP_PROFILE_KEY, JSON.stringify(profile));
}

/**
 * The mentor matches from /match, normalized to an array.
 *
 * `null` means matching has never run for the current profile (the key is
 * missing); `[]` means it ran and found nothing — pages treat those differently.
 */
export function getStoredMatches() {
  const stored = readJson(MENTOR_MATCHES_KEY);
  if (Array.isArray(stored)) return stored;
  if (stored && Array.isArray(stored.matches)) return stored.matches;
  return null;
}

export function setStoredMatches(matches) {
  write(MENTOR_MATCHES_KEY, JSON.stringify(matches));
}

/** Forgets the cached matches (e.g. a new deck was uploaded). */
export function clearStoredMatches() {
  remove(MENTOR_MATCHES_KEY);
}
