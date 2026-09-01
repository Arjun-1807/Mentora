"""
POST /feedback - records post-match feedback (attendance + rating) and
recomputes the mentor's rolling-average effectiveness score.
"""
import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import get_feedback_collection, get_mentors_collection
from app.models.schemas import FeedbackRequest, FeedbackResponse
from app.services.auth_dependency import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["feedback"])


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(request: FeedbackRequest, user=Depends(get_current_user)) -> FeedbackResponse:
    """Record feedback for a match and recompute the mentor's
    effectiveness_score as the rolling average rating (1-5) across all
    feedback recorded for that mentor."""
    try:
        mentor_object_id = ObjectId(request.mentor_id)
    except (InvalidId, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mentor_id: {request.mentor_id!r}") from exc

    feedback_collection = get_feedback_collection()
    mentors_collection = get_mentors_collection()

    feedback_doc = {
        "match_id": request.match_id,
        "mentor_id": request.mentor_id,
        "attended": request.attended,
        "rating": request.rating,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        feedback_collection.insert_one(feedback_doc)
    except Exception as exc:
        logger.exception("Failed to insert feedback document")
        raise HTTPException(status_code=502, detail=f"Failed to record feedback: {exc}") from exc

    ratings = [
        doc["rating"]
        for doc in feedback_collection.find({"mentor_id": request.mentor_id})
        if isinstance(doc.get("rating"), (int, float))
    ]
    new_effectiveness_score = round(sum(ratings) / len(ratings), 4) if ratings else 0.0

    try:
        mentors_collection.update_one(
            {"_id": mentor_object_id},
            {"$set": {"effectiveness_score": new_effectiveness_score}},
        )
    except Exception as exc:
        logger.exception("Failed to update mentor effectiveness_score")
        raise HTTPException(status_code=502, detail=f"Failed to update mentor effectiveness score: {exc}") from exc

    return FeedbackResponse(success=True, new_effectiveness_score=new_effectiveness_score)
