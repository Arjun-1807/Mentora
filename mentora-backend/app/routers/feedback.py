"""
POST /feedback         - records post-match feedback (attendance + rating),
                         recomputes the mentor's rolling-average
                         effectiveness score, and completes the match.
GET  /feedback/summary - per-mentor aggregate feedback stats for dashboards.

Authorization: feedback may only be submitted by the user who owns the
match record, exactly once per match (a second submission returns 409).
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.db.mongo import get_feedback_collection, get_matches_collection, get_mentors_collection
from app.models.schemas import (
    FeedbackRequest,
    FeedbackResponse,
    FeedbackSummaryResponse,
    MentorFeedbackStats,
)
from app.services.auth_dependency import get_current_user
from app.services.matches import advance_match_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["feedback"])


def _recompute_effectiveness(mentor_id: str) -> Dict[str, Any]:
    """Recompute a mentor's rolling stats with a server-side aggregation.

    Averaging in MongoDB ($group/$avg) instead of pulling every feedback
    document into Python keeps this O(1) in memory as feedback grows.
    """
    pipeline = [
        {"$match": {"mentor_id": mentor_id, "rating": {"$type": "number"}}},
        {
            "$group": {
                "_id": "$mentor_id",
                "average_rating": {"$avg": "$rating"},
                "feedback_count": {"$sum": 1},
                "attended_count": {"$sum": {"$cond": [{"$eq": ["$attended", True]}, 1, 0]}},
            }
        },
    ]
    rows = list(get_feedback_collection().aggregate(pipeline))
    if not rows:
        return {"average_rating": 0.0, "feedback_count": 0, "attended_count": 0}
    row = rows[0]
    return {
        "average_rating": round(float(row.get("average_rating") or 0.0), 4),
        "feedback_count": int(row.get("feedback_count") or 0),
        "attended_count": int(row.get("attended_count") or 0),
    }


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(request: FeedbackRequest, user=Depends(get_current_user)) -> FeedbackResponse:
    """Record feedback for one of the caller's own matches and recompute the
    mentor's `effectiveness_score` as the average rating (1-5) across all
    feedback for that mentor.

    Errors: 404 if the match does not exist, 403 if it belongs to another
    user, 400 if `mentor_id` does not match the match record, 409 if
    feedback for this match was already submitted.
    """
    user_id = str(user.get("sub", ""))

    try:
        mentor_object_id = ObjectId(request.mentor_id)
    except (InvalidId, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid mentor_id.") from exc

    try:
        match_doc = get_matches_collection().find_one({"match_id": request.match_id})
    except Exception:
        logger.exception("Failed to look up match %s", request.match_id)
        raise HTTPException(status_code=502, detail="Could not record feedback. Please try again shortly.")

    if not match_doc:
        raise HTTPException(status_code=404, detail="Match not found.")

    # Legacy match documents predate per-user ownership and therefore have
    # no owner to authorize against; they are treated as not owned.
    if str(match_doc.get("user_id") or "") != user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this match.")

    if str(match_doc.get("mentor_id") or "") != request.mentor_id:
        raise HTTPException(
            status_code=400,
            detail="mentor_id does not correspond to the mentor on this match record.",
        )

    feedback_collection = get_feedback_collection()

    feedback_doc = {
        "match_id": request.match_id,
        "mentor_id": request.mentor_id,
        "user_id": user_id,
        "attended": request.attended,
        "rating": request.rating,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # One feedback per match. The unique index on feedback.match_id makes
    # this race-free; the pre-check just gives a nicer error when the index
    # has not been created yet.
    if feedback_collection.find_one({"match_id": request.match_id}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Feedback has already been submitted for this match.")

    try:
        feedback_collection.insert_one(feedback_doc)
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=409, detail="Feedback has already been submitted for this match."
        ) from exc
    except Exception as exc:
        logger.exception("Failed to insert feedback document")
        raise HTTPException(
            status_code=502, detail="Could not record feedback. Please try again shortly."
        ) from exc

    try:
        stats = _recompute_effectiveness(request.mentor_id)
    except Exception as exc:
        logger.exception("Failed to aggregate feedback for mentor %s", request.mentor_id)
        raise HTTPException(
            status_code=502, detail="Feedback was recorded but the mentor score could not be updated."
        ) from exc

    new_effectiveness_score = stats["average_rating"]

    try:
        get_mentors_collection().update_one(
            {"_id": mentor_object_id},
            {
                "$set": {
                    "effectiveness_score": new_effectiveness_score,
                    "feedback_count": stats["feedback_count"],
                }
            },
        )
    except Exception as exc:
        logger.exception("Failed to update mentor effectiveness_score")
        raise HTTPException(
            status_code=502, detail="Feedback was recorded but the mentor score could not be updated."
        ) from exc

    # Feedback closes the loop on the match lifecycle.
    advance_match_status(request.match_id, user_id, "completed")

    return FeedbackResponse(success=True, new_effectiveness_score=new_effectiveness_score)


@router.get("/feedback/summary", response_model=FeedbackSummaryResponse)
async def feedback_summary(user=Depends(get_current_user)) -> FeedbackSummaryResponse:
    """Per-mentor aggregate feedback stats (count, average rating, attendance).

    A mentor account only sees its own row; startups see the full mentor
    leaderboard, which is the same aggregate information already exposed
    through mentors' `effectiveness_score`.
    """
    pipeline: List[Dict[str, Any]] = [
        {"$match": {"rating": {"$type": "number"}}},
        {
            "$group": {
                "_id": "$mentor_id",
                "feedback_count": {"$sum": 1},
                "average_rating": {"$avg": "$rating"},
                "attended_count": {"$sum": {"$cond": [{"$eq": ["$attended", True]}, 1, 0]}},
            }
        },
        {"$sort": {"average_rating": -1, "feedback_count": -1}},
    ]

    try:
        rows = list(get_feedback_collection().aggregate(pipeline))
    except Exception:
        logger.exception("Failed to aggregate feedback summary")
        raise HTTPException(status_code=502, detail="Could not load feedback summary. Please try again shortly.")

    names = _mentor_names([str(row.get("_id") or "") for row in rows])

    return FeedbackSummaryResponse(
        mentors=[
            MentorFeedbackStats(
                mentor_id=str(row.get("_id") or ""),
                name=names.get(str(row.get("_id") or "")),
                feedback_count=int(row.get("feedback_count") or 0),
                average_rating=round(float(row.get("average_rating") or 0.0), 4),
                attended_count=int(row.get("attended_count") or 0),
            )
            for row in rows
        ]
    )


def _mentor_names(mentor_ids: List[str]) -> Dict[str, Optional[str]]:
    """Resolve mentor ids to display names in a single query."""
    object_ids = []
    for mentor_id in mentor_ids:
        try:
            object_ids.append(ObjectId(mentor_id))
        except (InvalidId, TypeError):
            continue
    if not object_ids:
        return {}
    try:
        docs = get_mentors_collection().find({"_id": {"$in": object_ids}}, {"name": 1})
        return {str(doc["_id"]): doc.get("name") for doc in docs}
    except Exception:
        logger.exception("Failed to resolve mentor names for feedback summary")
        return {}
