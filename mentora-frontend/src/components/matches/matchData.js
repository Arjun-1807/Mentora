// Pure data helpers for the startup flow (no React imports).

/** Only the StartupProfile fields the backend's /match and /email accept. */
export function toStartupProfilePayload(profile) {
  if (!profile) return null;
  return {
    domain: profile.domain,
    stage: profile.stage,
    challenges: Array.isArray(profile.challenges) ? profile.challenges : [],
    team_gaps: Array.isArray(profile.team_gaps) ? profile.team_gaps : [],
    geography: profile.geography ?? null,
  };
}

/** Only the MentorMatch fields /email accepts (drops live status, meeting…). */
export function toMentorPayload(match) {
  if (!match) return null;
  return {
    mentor_id: match.mentor_id,
    name: match.name || match.mentor_name || "",
    domain: match.domain || "",
    stage_focus: match.stage_focus || "",
    expertise: Array.isArray(match.expertise) ? match.expertise : [],
    match_score: typeof match.match_score === "number" ? match.match_score : 0,
    match_id: match.match_id ?? null,
    email: match.email || match.mentor_email || null,
    geography: match.geography ?? null,
  };
}

/** 0-1 or 0-100 → integer percent, or null. */
export function scorePercent(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)));
}

/**
 * Overlays the live `status` / `meeting` from POST /matches/all onto the
 * matches cached in localStorage, keyed by the uuid `match_id`.
 * Returns a new array; matches without a live doc are left untouched.
 */
export function mergeLiveStatuses(stored, liveDocs) {
  if (!Array.isArray(stored)) return stored;
  const docs = Array.isArray(liveDocs) ? liveDocs : liveDocs?.matches;
  if (!Array.isArray(docs) || docs.length === 0) return stored;

  const byId = new Map();
  for (const doc of docs) {
    if (doc && doc.match_id) byId.set(doc.match_id, doc);
  }

  return stored.map((m) => {
    const live = m?.match_id ? byId.get(m.match_id) : null;
    if (!live) return m;
    const next = { ...m };
    if (live.status) next.status = live.status;
    if (live.meeting) next.meeting = live.meeting;
    if (!next.email && live.mentor_email) next.email = live.mentor_email;
    return next;
  });
}
