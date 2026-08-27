"""
Mentor matching: queries MongoDB Atlas Vector Search for mentors whose
embeddings are closest to the startup profile embedding, then applies a
weighted score boost for domain/stage matches.

Score convention: match_score is a float in the 0-1 range, computed as
    clamp(cosine_similarity + boosts, 0.0, 1.0)
where cosine_similarity itself is already in roughly [-1, 1] (in practice
close to [0, 1] since embeddings are normalized and semantically related).
"""
import logging
from typing import List

from fastapi import HTTPException

from app.config import settings
from app.db.mongo import get_mentors_collection
from app.models.schemas import MentorMatch, StartupProfile
from app.services.embeddings import build_startup_profile_text, embed_query

logger = logging.getLogger(__name__)

# --- Tunable weighted-boost constants -------------------------------------
DOMAIN_MATCH_BOOST = 0.10
STAGE_MATCH_BOOST = 0.10
# ---------------------------------------------------------------------------

# How many raw candidates to pull from vector search before boosting/re-ranking.
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
                "_id": 0,
                "name": 1,
                "domain": 1,
                "stage_focus": 1,
                "expertise": 1,
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

    ranked: List[MentorMatch] = []
    for candidate in candidates:
        base_score = float(candidate.get("score", 0.0))
        boost = 0.0

        candidate_domain = (candidate.get("domain") or "").strip().lower()
        candidate_stage = (candidate.get("stage_focus") or "").strip().lower()

        if candidate_domain and candidate_domain == profile.domain.strip().lower():
            boost += DOMAIN_MATCH_BOOST
        if candidate_stage and candidate_stage == profile.stage.strip().lower():
            boost += STAGE_MATCH_BOOST

        final_score = max(0.0, min(1.0, base_score + boost))

        ranked.append(
            MentorMatch(
                name=candidate.get("name", "Unknown"),
                domain=candidate.get("domain", "Unknown"),
                stage_focus=candidate.get("stage_focus", "Unknown"),
                expertise=candidate.get("expertise", []),
                match_score=round(final_score, 4),
            )
        )

    ranked.sort(key=lambda m: m.match_score, reverse=True)
    return ranked[:TOP_K_RESULTS]
