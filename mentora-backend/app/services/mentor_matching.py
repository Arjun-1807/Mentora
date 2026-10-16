"""
Mentor matching: queries MongoDB Atlas Vector Search for mentors whose
embeddings are closest to the startup profile embedding, then combines
similarity with several weighted match factors.

Score convention: match_score is a float in the 0-1 range, computed as

    final_score = similarity     * SIMILARITY_WEIGHT
                + need_fit       * NEED_FIT_WEIGHT
                + domain_match   * DOMAIN_MATCH_WEIGHT
                + stage_match    * STAGE_MATCH_WEIGHT
                + geography      * GEOGRAPHY_MATCH_WEIGHT
                + effectiveness  * EFFECTIVENESS_WEIGHT

(see the module constants below and README "Scoring / matching details").
"""
import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from fastapi import HTTPException

from app.config import settings
from app.db.mongo import get_mentors_collection
from app.models.schemas import MentorMatch, StartupProfile
from app.services.embeddings import build_startup_profile_text, embed_passages, embed_queries, embed_query

logger = logging.getLogger(__name__)

# --- Weighted-scoring formula weights (sum to 1.0) --------------------------
SIMILARITY_WEIGHT = 0.35
NEED_FIT_WEIGHT = 0.22
DOMAIN_MATCH_WEIGHT = 0.15
STAGE_MATCH_WEIGHT = 0.12
GEOGRAPHY_MATCH_WEIGHT = 0.05
EFFECTIVENESS_WEIGHT = 0.11
# Backward-compatible alias (the profile-level similarity used to be called
# the cosine term).
COSINE_WEIGHT = SIMILARITY_WEIGHT
# ---------------------------------------------------------------------------

# --- Similarity calibration -------------------------------------------------
# Atlas returns vectorSearchScore = (1 + cos) / 2 for cosine indexes, so the
# raw score of every candidate sits in a narrow ~0.75-0.90 band. We undo
# that mapping (cos = 2s - 1) and stretch the band that BGE cosines actually
# occupy onto [0, 1]. Both constants were fitted on the eval set
# (tests/fixtures/eval_set.json, 32 profiles x 17 staging mentors, mentor
# embeddings including skills): COS_FLOOR ~ 5th percentile of all candidate
# cosines (0.534), COS_CEIL ~ the best cosine seen (0.836). Re-fit them
# (scripts/eval_matching.py --set COS_FLOOR=...) if the embedding model or
# the profile text templates change.
COS_FLOOR = 0.53
COS_CEIL = 0.84
# ---------------------------------------------------------------------------

# --- Need fit (startup challenges / team gaps vs mentor skills) --------------
# Per-pair cosines between a query-embedded need and a passage-embedded skill
# are short-text cosines with their own range, so they get their own
# constants, fitted on the eval set (32 profiles x 15 seeded mentors): the
# 5th and 99th percentile of each need's best-skill cosine.
SKILL_COS_FLOOR = 0.34
SKILL_COS_CEIL = 0.75
# need_fit of a mentor without any skills (nothing to compare against): a
# neutral prior at the eval-set median calibrated need_fit (~0.32), so legacy
# accounts that never filled in skills are neither boosted nor buried.
NEED_FIT_UNKNOWN = 0.3
# At most this many startup needs are compared (long LLM lists add noise).
MAX_NEEDS = 12
# `reasons` lists up to MAX_REASONS need -> skill pairs whose calibrated
# similarity is at least REASON_MIN_SIMILARITY.
MAX_REASONS = 3
REASON_MIN_SIMILARITY = 0.5
# ---------------------------------------------------------------------------

# How many raw candidates to pull from vector search before re-ranking.
VECTOR_SEARCH_CANDIDATE_LIMIT = 20
TOP_K_RESULTS = 5

# Stage value meaning "mentors startups at any stage".
ALL_STAGES = "all"

# Synonym groups for domain_match, mapping every label we see onto the
# MentorSector vocabulary of mentor onboarding (app/models/schemas.py): the
# LLM used to answer "Climate Tech" / "AI/ML" / "E-commerce", the seeded
# mentors use those labels too, while onboarded mentors pick "Clean Energy" /
# "DeepTech" / "D2C". Keys are normalised (lowercase, alphanumerics only);
# values are the MentorSector labels.
_DOMAIN_SYNONYMS = {
    **dict.fromkeys(
        ["cleanenergy", "climatetech", "climate", "cleantech", "greentech", "renewableenergy", "renewables",
         "energy", "ev", "electricvehicles", "sustainability"],
        "Clean Energy",
    ),
    **dict.fromkeys(
        ["fintech", "financialtechnology", "insurtech", "insurance", "wealthtech", "lending", "payments",
         "regtech", "neobanking", "crypto", "web3"],
        "FinTech",
    ),
    **dict.fromkeys(["healthtech", "healthcare", "medtech", "digitalhealth", "healthtechnology"], "HealthTech"),
    **dict.fromkeys(["edtech", "education", "educationtechnology", "edutech"], "EdTech"),
    **dict.fromkeys(["agritech", "agtech", "agriculture", "foodtech", "agrifoodtech"], "AgriTech"),
    **dict.fromkeys(
        ["d2c", "directtoconsumer", "ecommerce", "eretail", "retail", "consumer", "consumerbrands",
         "quickcommerce", "qcommerce"],
        "D2C",
    ),
    **dict.fromkeys(["saas", "b2bsaas", "software", "enterprisesoftware", "devtools"], "SaaS"),
    **dict.fromkeys(
        ["deeptech", "aiml", "ai", "artificialintelligence", "machinelearning", "ml", "robotics", "quantum",
         "semiconductors", "spacetech", "hardware"],
        "DeepTech",
    ),
    **dict.fromkeys(["logistics", "supplychain", "freight", "shipping", "transportation"], "Logistics"),
    **dict.fromkeys(["others", "other"], "Others"),
}
# A catch-all label carries no signal: two "Others" never count as a match.
_NON_MATCHING_SECTORS = {"", "Others"}


def canonical_domain(domain: Optional[str]) -> str:
    """Normalise a domain label onto the MentorSector vocabulary so synonyms
    compare equal; unknown labels come back lower-cased ("" if blank)."""
    raw = (domain or "").strip().lower()
    key = "".join(ch for ch in raw if ch.isalnum())
    return _DOMAIN_SYNONYMS.get(key, raw)


def canonical_sectors(labels: Iterable[Optional[str]]) -> set:
    """Canonical, matchable sectors of a list of labels (blank/Others dropped)."""
    return {canonical_domain(label) for label in labels if label} - _NON_MATCHING_SECTORS


def _domain_matches(profile: StartupProfile, candidate: Dict[str, Any]) -> bool:
    """True if any of the startup's sectors (or its domain) overlaps any of
    the mentor's sector_expertise or domain, after canonical_domain()."""
    startup = canonical_sectors(list(getattr(profile, "sectors", None) or []) + [profile.domain])
    mentor_labels = candidate.get("sector_expertise")
    mentor_labels = list(mentor_labels) if isinstance(mentor_labels, (list, tuple)) else []
    mentor = canonical_sectors(mentor_labels + [candidate.get("domain")])
    return bool(startup & mentor)


def calibrate_similarity(vector_search_score: float) -> float:
    """Map an Atlas cosine vectorSearchScore onto a 0-1 similarity that
    actually spreads candidates apart (see COS_FLOOR / COS_CEIL)."""
    cosine = 2.0 * float(vector_search_score) - 1.0
    return max(0.0, min(1.0, (cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR)))


def calibrate_skill_similarity(cosine):
    """Calibrate need-to-skill cosine(s) (float or numpy array) onto [0, 1]."""
    return np.clip((np.asarray(cosine, dtype=float) - SKILL_COS_FLOOR) / (SKILL_COS_CEIL - SKILL_COS_FLOOR), 0.0, 1.0)


def _stage_matches(profile_stage: str, stage_focus: Optional[str], preferred_stages: Optional[Iterable]) -> bool:
    """True if a mentor with this stage_focus / preferred_stages covers profile_stage."""
    stages = {(stage_focus or "").strip().lower()}
    if isinstance(preferred_stages, (list, tuple, set)):
        stages.update(str(s).strip().lower() for s in preferred_stages if s)
    stages.discard("")
    if not stages:
        return False
    return ALL_STAGES in stages or (bool(profile_stage) and profile_stage in stages)


# --- need fit -------------------------------------------------------------------

def startup_needs(profile: StartupProfile) -> List[str]:
    """The startup's challenges followed by its team gaps (stripped,
    de-duplicated, capped at MAX_NEEDS)."""
    needs: List[str] = []
    seen = set()
    for item in list(profile.challenges or []) + list(profile.team_gaps or []):
        text = str(item or "").strip()
        if text and text.lower() not in seen:
            seen.add(text.lower())
            needs.append(text)
    return needs[:MAX_NEEDS]


def mentor_skills(candidate: Dict[str, Any]) -> List[str]:
    """A mentor's skills; legacy documents without `skills` fall back to
    their `expertise` entries that are not just sector names (onboarding
    used to overwrite expertise with the sector list)."""
    skills = [str(s).strip() for s in (candidate.get("skills") or []) if str(s or "").strip()]
    if skills:
        return skills
    sector_like = {canonical_domain(s) for s in (candidate.get("sector_expertise") or [])}
    sector_like.add(canonical_domain(candidate.get("domain")))
    sector_like.update(_DOMAIN_SYNONYMS.values())
    expertise = [str(e).strip() for e in (candidate.get("expertise") or []) if str(e or "").strip()]
    return [e for e in expertise if canonical_domain(e) not in sector_like]


def _skill_matrices(candidates: Sequence[Dict[str, Any]]) -> List[Optional[np.ndarray]]:
    """Per candidate, a (skills x dim) matrix of normalised skill embeddings
    (None if the mentor has no skills). Stored `skill_embeddings` are used
    when they line up with the skills; anything missing is embedded in one
    batch call."""
    matrices: List[Optional[np.ndarray]] = [None] * len(candidates)
    missing: List[Tuple[int, List[str]]] = []
    for index, candidate in enumerate(candidates):
        skills = mentor_skills(candidate)
        if not skills:
            continue
        stored = candidate.get("skill_embeddings")
        if candidate.get("skills") and isinstance(stored, list) and len(stored) == len(skills) and stored:
            matrices[index] = np.asarray(stored, dtype=float)
        else:
            missing.append((index, skills))
    if missing:
        flat = [skill for _, skills in missing for skill in skills]
        vectors = embed_passages(flat)
        offset = 0
        for index, skills in missing:
            matrices[index] = np.asarray(vectors[offset: offset + len(skills)], dtype=float)
            offset += len(skills)
    return matrices


def compute_need_fit(
    needs: Sequence[str],
    need_vectors: Optional[np.ndarray],
    skills: Sequence[str],
    skill_matrix: Optional[np.ndarray],
) -> Tuple[float, List[str]]:
    """need_fit = mean over needs of the best calibrated similarity to any
    of the mentor's skills; plus the best need -> skill pairs as reasons.

    Returns (NEED_FIT_UNKNOWN, []) for a mentor without skills and
    (0.0, []) for a startup without needs.
    """
    if not needs or need_vectors is None or len(need_vectors) == 0:
        return 0.0, []
    if not skills or skill_matrix is None or len(skill_matrix) == 0:
        return NEED_FIT_UNKNOWN, []
    similarity = calibrate_skill_similarity(need_vectors @ skill_matrix.T)  # needs x skills
    best_skill = similarity.argmax(axis=1)
    best = similarity.max(axis=1)
    need_fit = float(best.mean())

    reasons: List[str] = []
    used_skills = set()
    for need_index in np.argsort(-best, kind="stable"):
        if len(reasons) >= MAX_REASONS or best[need_index] < REASON_MIN_SIMILARITY:
            break
        skill_index = int(best_skill[need_index])
        if skill_index in used_skills:
            continue
        used_skills.add(skill_index)
        reasons.append(f"{needs[int(need_index)]} → {skills[skill_index]}")
    return need_fit, reasons


NO_MENTORS_MESSAGE = "No mentor profiles found. Please seed the database."


def ensure_mentors_exist() -> None:
    """Raise 404 if the mentors collection is empty.

    Called by the /match and /evaluate routers *before* running the
    pipeline, so an unseeded database gets an actionable error instead of
    an empty result (or an opaque vector-search failure).
    """
    try:
        has_any = get_mentors_collection().find_one({}, {"_id": 1}) is not None
    except Exception as exc:
        logger.exception("Failed to check whether any mentor profiles exist")
        raise HTTPException(
            status_code=502,
            detail="Mentor search is temporarily unavailable. Please try again shortly.",
        ) from exc
    if not has_any:
        raise HTTPException(status_code=404, detail=NO_MENTORS_MESSAGE)


def _run_vector_search(embedding: List[float]) -> List[dict]:
    collection = get_mentors_collection()

    pipeline = [
        {
            "$vectorSearch": {
                "index": settings.MONGODB_VECTOR_INDEX_NAME,
                "path": "embedding",
                "queryVector": embedding,
                "numCandidates": VECTOR_SEARCH_CANDIDATE_LIMIT * 10,
                "limit": VECTOR_SEARCH_CANDIDATE_LIMIT,
            }
        },
        {
            "$project": {
                "_id": 1,
                "name": 1,
                "domain": 1,
                "sector_expertise": 1,
                "stage_focus": 1,
                "expertise": 1,
                "skills": 1,
                "skill_embeddings": 1,
                "geography": 1,
                "email": 1,
                "preferred_stages": 1,
                "effectiveness_score": 1,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ]

    try:
        return list(collection.aggregate(pipeline))
    except Exception as exc:
        # Log the full error server-side; return a generic message so that
        # internal details (connection strings, driver internals) never
        # reach the client.
        logger.exception(
            "MongoDB Atlas Vector Search query failed (index=%r, collection=%r)",
            settings.MONGODB_VECTOR_INDEX_NAME,
            settings.MONGODB_MENTORS_COLLECTION,
        )
        raise HTTPException(
            status_code=502,
            detail="Mentor search is temporarily unavailable. Please try again shortly.",
        ) from exc


def find_matching_mentors(profile: StartupProfile) -> List[MentorMatch]:
    """Find and rank the top mentors for a given startup profile."""
    profile_text = build_startup_profile_text(
        domain=profile.domain,
        stage=profile.stage,
        challenges=profile.challenges,
        team_gaps=profile.team_gaps,
    )
    query_embedding = embed_query(profile_text)

    candidates = _run_vector_search(query_embedding)

    if not candidates:
        return []

    needs = startup_needs(profile)
    need_vectors = np.asarray(embed_queries(needs), dtype=float) if needs else None
    skill_matrices = _skill_matrices(candidates)

    profile_stage = (profile.stage or "").strip().lower()
    profile_geography = (profile.geography or "").strip().lower()

    ranked: List[MentorMatch] = []
    for candidate, skill_matrix in zip(candidates, skill_matrices):
        raw_score = max(0.0, min(1.0, float(candidate.get("score", 0.0))))
        similarity = calibrate_similarity(raw_score)
        need_fit, reasons = compute_need_fit(needs, need_vectors, mentor_skills(candidate), skill_matrix)

        candidate_geography = (candidate.get("geography") or "").strip().lower()
        candidate_effectiveness = candidate.get("effectiveness_score")

        stage_match = (
            1.0
            if _stage_matches(profile_stage, candidate.get("stage_focus"), candidate.get("preferred_stages"))
            else 0.0
        )
        domain_match = 1.0 if _domain_matches(profile, candidate) else 0.0
        geography_match = (
            1.0 if profile_geography and candidate_geography and candidate_geography == profile_geography else 0.0
        )
        effectiveness_score_normalized = (candidate_effectiveness or 0.0) / 5.0

        final_score = (
            similarity * SIMILARITY_WEIGHT
            + need_fit * NEED_FIT_WEIGHT
            + stage_match * STAGE_MATCH_WEIGHT
            + domain_match * DOMAIN_MATCH_WEIGHT
            + geography_match * GEOGRAPHY_MATCH_WEIGHT
            + effectiveness_score_normalized * EFFECTIVENESS_WEIGHT
        )
        final_score = max(0.0, min(1.0, final_score))

        ranked.append(
            MentorMatch(
                mentor_id=str(candidate.get("_id", "")),
                name=candidate.get("name") or "Unknown",
                domain=candidate.get("domain") or "Unknown",
                stage_focus=candidate.get("stage_focus") or "Unknown",
                expertise=candidate.get("expertise") or [],
                match_score=round(final_score, 4),
                email=candidate.get("email"),
                geography=candidate.get("geography"),
                similarity=round(raw_score, 4),
                reasons=reasons,
            )
        )

    ranked.sort(key=lambda m: m.match_score, reverse=True)
    return ranked[:TOP_K_RESULTS]
