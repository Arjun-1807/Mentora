"""
POST /match - accepts a structured startup profile and returns the top
mentor matches from MongoDB Atlas Vector Search.

POST /matches/all - returns every document from the `matches` collection
(the history of match records written by POST /match).
"""
import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends

from app.db.mongo import get_matches_collection
from app.models.schemas import MatchResponse, StartupProfile
from app.services.auth_dependency import get_current_user
from app.services.mentor_matching import find_matching_mentors

logger = logging.getLogger(__name__)

router = APIRouter(tags=["match"])


@router.post("/match", response_model=MatchResponse)
async def match_mentors(profile: StartupProfile, user=Depends(get_current_user)) -> MatchResponse:
    """Given a startup profile (domain, stage, challenges, team_gaps, geography),
    return the top 5 matching mentors ranked by weighted match score.

    Each returned match is also recorded as a document in the `matches`
    collection for later lookup (see POST /matches/all) and feedback (POST /feedback).
    """
    matches = find_matching_mentors(profile)

    if matches:
        collection = get_matches_collection()
        profile_dict = profile.model_dump()
        timestamp = datetime.now(timezone.utc).isoformat()
        match_docs = [
            {
                "match_id": str(uuid4()),
                "startup_profile": profile_dict,
                "mentor_id": match.mentor_id,
                "score": match.match_score,
                "timestamp": timestamp,
                "status": "pending",
            }
            for match in matches
        ]
        try:
            collection.insert_many(match_docs)
        except Exception:
            logger.exception("Failed to record match documents in the 'matches' collection")

    return MatchResponse(matches=matches)


@router.post("/matches/all")
async def get_all_matches() -> dict:
    """Return all documents from the `matches` collection, JSON-serializable
    (ObjectIds and datetimes converted to strings)."""
    collection = get_matches_collection()
    docs = []
    for doc in collection.find({}):
        clean = {}
        for key, value in doc.items():
            if key == "_id":
                clean["_id"] = str(value)
            elif isinstance(value, datetime):
                clean[key] = value.isoformat()
            else:
                clean[key] = value
        docs.append(clean)
    return {"matches": docs}
