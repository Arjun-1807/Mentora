"""
POST /match  - accepts a structured startup profile and returns the top
               mentor matches from MongoDB Atlas Vector Search.
POST /matches/all
             - returns the calling user's match records only (see the
               scoping rule documented on the handler).
GET  /mentors - mentor directory (never includes embeddings).
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.mongo import get_matches_collection, get_mentors_collection, get_users_collection
from app.models.schemas import (
    MatchResponse,
    MentorListItem,
    MentorListResponse,
    StartupProfile,
)
from app.services.auth_dependency import get_current_user
from app.services.matches import record_matches
from app.services.mentor_matching import find_matching_mentors

logger = logging.getLogger(__name__)

router = APIRouter(tags=["match"])


def _jsonable(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Make a Mongo document JSON-serializable (ObjectIds/datetimes -> str)."""
    clean: Dict[str, Any] = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            clean[key] = str(value)
        elif isinstance(value, datetime):
            clean[key] = value.isoformat()
        else:
            clean[key] = value
    return clean


def _linked_mentor_id(user_id: str) -> Optional[str]:
    """Return the mentors-collection _id linked to a user account, if any."""
    try:
        user = get_users_collection().find_one(
            {"_id": ObjectId(user_id)}, {"mentor_id": 1}
        )
    except (InvalidId, TypeError):
        return None
    except Exception:
        logger.exception("Failed to look up linked mentor id for user %s", user_id)
        return None
    if not user:
        return None
    mentor_id = user.get("mentor_id")
    return str(mentor_id) if mentor_id else None


@router.post("/match", response_model=MatchResponse)
async def match_mentors(profile: StartupProfile, user=Depends(get_current_user)) -> MatchResponse:
    """Given a startup profile (domain, stage, challenges, team_gaps, geography),
    return the top 5 matching mentors ranked by weighted match score.

    Each returned match is recorded in the `matches` collection, stamped
    with the calling user's id and upserted on
    `(user_id, mentor_id, profile_fingerprint)` so that re-matching the
    same profile refreshes the existing records rather than duplicating
    history. The returned `match_id` is the handle to pass to /email and
    /feedback.
    """
    matches = find_matching_mentors(profile)

    if matches:
        record_matches(user_id=str(user.get("sub", "")), profile=profile, matches=matches)

    return MatchResponse(matches=matches)


@router.post("/matches/all")
async def get_all_matches(user=Depends(get_current_user)) -> dict:
    """Return the caller's match records (authentication required).

    Scoping rule:
      * a `startup` user sees the matches they created (`user_id == sub`);
      * a `mentor` user sees the matches pointing at their own mentor
        record (`mentor_id == <their linked mentor doc _id>`), so they can
        see incoming interest without seeing other startups' matches.

    Nobody sees the whole collection: before this change the endpoint was
    unauthenticated and returned every stored startup_profile.
    """
    user_id = str(user.get("sub", ""))
    role = user.get("role", "")

    if role == "mentor":
        mentor_id = _linked_mentor_id(user_id)
        # A mentor account with no linked mentor document has no incoming
        # matches; fall back to their own outgoing matches (if any).
        query = {"mentor_id": mentor_id} if mentor_id else {"user_id": user_id}
    else:
        query = {"user_id": user_id}

    try:
        docs = [_jsonable(doc) for doc in get_matches_collection().find(query).sort("timestamp", -1)]
    except Exception:
        logger.exception("Failed to list match records for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load match history. Please try again shortly.")

    return {"matches": docs}


@router.get("/mentors", response_model=MentorListResponse)
async def list_mentors(
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    domain: Optional[str] = Query(default=None, description="Case-insensitive exact domain filter"),
    stage_focus: Optional[str] = Query(default=None, description="Filter by idea/MVP/growth"),
    user=Depends(get_current_user),
) -> MentorListResponse:
    """Mentor directory for a browse view.

    The `embedding` field is explicitly projected out - it is ~768 floats
    per mentor and of no use to clients.
    """
    query: Dict[str, Any] = {}
    if domain:
        query["domain"] = {"$regex": f"^{domain.strip()}$", "$options": "i"}
    if stage_focus:
        query["stage_focus"] = {"$regex": f"^{stage_focus.strip()}$", "$options": "i"}

    projection = {"embedding": 0}

    try:
        collection = get_mentors_collection()
        total = collection.count_documents(query)
        docs = list(collection.find(query, projection).skip(skip).limit(limit))
    except Exception:
        logger.exception("Failed to list mentors")
        raise HTTPException(status_code=502, detail="Could not load mentors. Please try again shortly.")

    mentors: List[MentorListItem] = [
        MentorListItem(
            mentor_id=str(doc.get("_id", "")),
            name=doc.get("name") or "Unknown",
            domain=doc.get("domain") or "Unknown",
            stage_focus=doc.get("stage_focus") or "Unknown",
            expertise=doc.get("expertise") or [],
            geography=doc.get("geography"),
            effectiveness_score=doc.get("effectiveness_score"),
            feedback_count=int(doc.get("feedback_count") or 0),
        )
        for doc in docs
    ]

    return MentorListResponse(mentors=mentors, total=total)
