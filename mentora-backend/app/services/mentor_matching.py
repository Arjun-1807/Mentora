"""
Mentor matching: queries MongoDB Atlas Vector Search for mentors whose
embeddings are closest to the startup profile embedding, then combines
similarity with several weighted match factors.

Score convention: match_score is a float in the 0-1 range, computed as

    final_score = cosine_score * 0.5
                + stage_match * 0.2
                + domain_match * 0.15
                + geography_match * 0.05
                + effectiveness_score_normalized * 0.10

where:
  - cosine_score is the raw $vectorSearch score, clamped to [0, 1].
  - stage_match is 1.0 if mentor.stage_focus == startup.stage, else 0.0.
  - domain_match is 1.0 if mentor.domain == startup.domain (case-insensitive), else 0.0.
  - geography_match is 1.0 if mentor.geography == startup.geography (case-insensitive,
    both present), else 0.0.
  - effectiveness_score_normalized = (mentor.effectiveness_score or 0.0) / 5.0
    (mentors with no feedback yet contribute 0 here).
"""
import logging
from typing import List

from fastapi import HTTPException

from app.config import settings
from app.db.mongo import get_mentors_collection
from app.models.schemas import MentorMatch, StartupProfile
from app.services.embeddings import build_startup_profile_text, embed_query

logger = logging.getLogger(__name__)

# --- Weighted-scoring formula weights --------------------------------------
COSINE_WEIGHT = 0.5
STAGE_MATCH_WEIGHT = 0.2
DOMAIN_MATCH_WEIGHT = 0.15
GEOGRAPHY_MATCH_WEIGHT = 0.05
EFFECTIVENESS_WEIGHT = 0.10
# ---------------------------------------------------------------------------

# How many raw candidates to pull from vector search before re-ranking.
VECTOR_SEARCH_CANDIDATE_LIMIT = 20
TOP_K_RESULTS = 5


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
                "stage_focus": 1,
                "expertise": 1,
                "geography": 1,
                "effectiveness_score": 1,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ]

    try:
        return list(collection.aggregate(pipeline))
    except Exception as exc:
        logger.exception("MongoDB Atlas Vector Search query failed")
        raise HTTPException(
            status_code=502,
            detail=(
                "Vector search query failed. Ensure the 'mentor_vector_index' "
                f"Atlas Search index exists on the '{settings.MONGODB_MENTORS_COLLECTION}' "
                f"collection and the database is reachable. Details: {exc}"
            ),
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

    profile_domain = (profile.domain or "").strip().lower()
    profile_stage = (profile.stage or "").strip().lower()
    profile_geography = (profile.geography or "").strip().lower()

    ranked: List[MentorMatch] = []
    for candidate in candidates:
        cosine_score = max(0.0, min(1.0, float(candidate.get("score", 0.0))))

        candidate_domain = (candidate.get("domain") or "").strip().lower()
        candidate_stage = (candidate.get("stage_focus") or "").strip().lower()
        candidate_geography = (candidate.get("geography") or "").strip().lower()
        candidate_effectiveness = candidate.get("effectiveness_score")

        stage_match = 1.0 if candidate_stage and candidate_stage == profile_stage else 0.0
        domain_match = 1.0 if candidate_domain and candidate_domain == profile_domain else 0.0
        geography_match = (
            1.0 if profile_geography and candidate_geography and candidate_geography == profile_geography else 0.0
        )
        effectiveness_score_normalized = (candidate_effectiveness or 0.0) / 5.0

        final_score = (
            cosine_score * COSINE_WEIGHT
            + stage_match * STAGE_MATCH_WEIGHT
            + domain_match * DOMAIN_MATCH_WEIGHT
            + geography_match * GEOGRAPHY_MATCH_WEIGHT
            + effectiveness_score_normalized * EFFECTIVENESS_WEIGHT
        )
        final_score = max(0.0, min(1.0, final_score))

        ranked.append(
            MentorMatch(
                mentor_id=str(candidate.get("_id", "")),
                name=candidate.get("name", "Unknown"),
                domain=candidate.get("domain", "Unknown"),
                stage_focus=candidate.get("stage_focus", "Unknown"),
                expertise=candidate.get("expertise", []),
                match_score=round(final_score, 4),
            )
        )

    ranked.sort(key=lambda m: m.match_score, reverse=True)
    return ranked[:TOP_K_RESULTS]
