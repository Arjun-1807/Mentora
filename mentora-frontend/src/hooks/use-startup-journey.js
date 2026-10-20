"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStartupMe, listMatches } from "@/lib/api";
import {
  getStoredMatches,
  getStoredProfile,
  setStoredMatches,
  setStoredProfile,
} from "@/lib/storage";

/** `active_profile` from GET /startup/me, flattened to the cached profile shape. */
export function flattenProfile(active) {
  if (!active || !active.profile) return null;
  return {
    ...active.profile,
    deck_feedback: active.deck_feedback ?? null,
    profile_id: active.profile_id,
    version: active.version,
    source: active.source,
    deck_filename: active.deck_filename ?? null,
  };
}

function sameMatch(a, b) {
  if (!a || !b) return false;
  if (a.match_id && b.match_id) return a.match_id === b.match_id;
  return Boolean(a._id) && a._id === b._id;
}

/**
 * The startup's journey state, loaded from the API (the source of truth):
 * GET /startup/me (company + active profile) and GET /matches.
 *
 * localStorage is only a cache: it seeds the first render so pages don't
 * flash empty, and is overwritten by every server response. `profile` is
 * null when the server has no profile yet (the caller decides what to show;
 * nothing here redirects). `matches` is null until the first load finishes.
 */
export function useStartupJourney({ withMatches = true } = {}) {
  const [startup, setStartup] = useState(null);
  const [profile, setProfile] = useState(null);
  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const cachedProfile = getStoredProfile();
    if (cachedProfile) setProfile(cachedProfile);
    const cachedMatches = getStoredMatches();
    if (withMatches && Array.isArray(cachedMatches)) setMatches(cachedMatches);
  }, [withMatches]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([getStartupMe(), withMatches ? listMatches() : Promise.resolve(null)])
      .then(([me, matchData]) => {
        if (cancelled) return;
        setStartup(me || null);
        const flat = flattenProfile(me?.active_profile);
        setProfile(flat);
        if (flat) setStoredProfile(flat);
        if (withMatches) {
          const list = Array.isArray(matchData?.matches) ? matchData.matches : [];
          setMatches(list);
          setStoredMatches(list);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load your startup.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, withMatches]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Optimistically replaces one match (e.g. with the doc an action returned). */
  const replaceMatch = useCallback((next) => {
    if (!next) return;
    setMatches((prev) => {
      if (!Array.isArray(prev)) return prev;
      const list = prev.map((m) => (sameMatch(m, next) ? { ...m, ...next } : m));
      setStoredMatches(list);
      return list;
    });
  }, []);

  /** Applies a server response shaped like GET /startup/me. */
  const applyStartup = useCallback((me) => {
    if (!me) return;
    setStartup(me);
    const flat = flattenProfile(me.active_profile);
    setProfile(flat);
    if (flat) setStoredProfile(flat);
  }, []);

  return { startup, profile, matches, loading, loaded, error, reload, replaceMatch, applyStartup };
}
