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
    sectors: Array.isArray(profile.sectors) ? profile.sectors : [],
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
