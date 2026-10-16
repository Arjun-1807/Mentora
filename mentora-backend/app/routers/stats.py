"""
Dashboard stat cards.

GET /dashboard/stats (JWT) -> {total_matches, emails_sent, meetings_accepted, avg_rating}
    Scoped like POST /matches/all: a startup counts the matches it created,
    a mentor the matches pointing at its mentor record.
      emails_sent       = matches at `email_sent` or later, or carrying
                          `email_sent_at` (e.g. later declined).
      meetings_accepted = accepted / meeting_scheduled / completed.
      avg_rating        = mean rating of the caller's feedback (a startup's
                          submitted feedback; a mentor's received feedback),
                          null when there is none.

GET /mentor/stats (JWT, mentor) -> {pending_requests, accepted, avg_rating, total_helped}
      pending_requests = pending / emailed / email_sent
      accepted         = accepted / meeting_scheduled / completed
      avg_rating       = mean rating of feedback received, null if none
      total_helped     = distinct startups with a meeting_scheduled/completed match
"""
import logging
from typing import Any, Dict, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import get_feedback_collection, get_matches_collection, get_users_collection
from app.models.schemas import DashboardStatsResponse, MentorStatsResponse
from app.services.auth_dependency import get_current_user
from app.services.matches import (
    ACCEPTED_STATUSES,
    EMAIL_SENT_OR_LATER,
    MEETING_STATUSES,
    REQUEST_STATUSES,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stats"])

STATS_UNAVAILABLE = "Could not load your stats. Please try again shortly."


def _linked_mentor_id(user_id: str) -> Optional[str]:
    try:
        doc = get_users_collection().find_one({"_id": ObjectId(user_id)}, {"mentor_id": 1})
    except (InvalidId, TypeError):
        return None
    mentor_id = (doc or {}).get("mentor_id")
    return str(mentor_id) if mentor_id else None


def _avg_rating(feedback_filter: Dict[str, Any]) -> Optional[float]:
    pipeline = [
        {"$match": {**feedback_filter, "rating": {"$type": "number"}}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]
    rows = list(get_feedback_collection().aggregate(pipeline))
    if not rows or not rows[0].get("count"):
        return None
    return round(float(rows[0]["avg"]), 2)


@router.get("/dashboard/stats", response_model=DashboardStatsResponse)
async def dashboard_stats(user=Depends(get_current_user)) -> DashboardStatsResponse:
    user_id = str(user.get("sub", ""))
    try:
        if user.get("role") == "mentor":
            mentor_id = _linked_mentor_id(user_id)
            match_filter = {"mentor_id": mentor_id} if mentor_id else {"user_id": user_id}
            feedback_filter = {"mentor_id": mentor_id} if mentor_id else {"user_id": user_id}
        else:
            match_filter = {"user_id": user_id}
            feedback_filter = {"user_id": user_id}

        matches = get_matches_collection()
        total = matches.count_documents(match_filter)
        emails_sent = matches.count_documents(
            {
                **match_filter,
                "$or": [
                    {"status": {"$in": EMAIL_SENT_OR_LATER}},
                    {"email_sent_at": {"$exists": True, "$ne": None}},
                ],
            }
        )
        accepted = matches.count_documents({**match_filter, "status": {"$in": ACCEPTED_STATUSES}})
        avg_rating = _avg_rating(feedback_filter)
    except Exception:
        logger.exception("Failed to compute dashboard stats for user %s", user_id)
        raise HTTPException(status_code=502, detail=STATS_UNAVAILABLE)

    return DashboardStatsResponse(
        total_matches=total, emails_sent=emails_sent, meetings_accepted=accepted, avg_rating=avg_rating
    )


@router.get("/mentor/stats", response_model=MentorStatsResponse)
async def mentor_stats(user=Depends(get_current_user)) -> MentorStatsResponse:
    if user.get("role") != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can view mentor stats.")

    user_id = str(user.get("sub", ""))
    try:
        mentor_id = _linked_mentor_id(user_id)
        if not mentor_id:
            return MentorStatsResponse(pending_requests=0, accepted=0, avg_rating=None, total_helped=0)

        matches = get_matches_collection()
        pending = matches.count_documents({"mentor_id": mentor_id, "status": {"$in": REQUEST_STATUSES}})
        accepted = matches.count_documents({"mentor_id": mentor_id, "status": {"$in": ACCEPTED_STATUSES}})
        helped = matches.distinct("user_id", {"mentor_id": mentor_id, "status": {"$in": MEETING_STATUSES}})
        avg_rating = _avg_rating({"mentor_id": mentor_id})
    except Exception:
        logger.exception("Failed to compute mentor stats for user %s", user_id)
        raise HTTPException(status_code=502, detail=STATS_UNAVAILABLE)

    return MentorStatsResponse(
        pending_requests=pending,
        accepted=accepted,
        avg_rating=avg_rating,
        total_helped=len([u for u in helped if u]),
    )
