"""
Startup health score endpoints (see app/services/health.py for the formula).

POST /health/log           (JWT; the startup owning the match or its mentor)
GET  /health/cohort        (JWT; coordinator only)
GET  /health/{startup_id}  (JWT; the startup itself, a coordinator, or a
                            mentor matched with that startup; "me" = caller)

`/health/cohort` is declared before `/health/{startup_id}` so "cohort" is
never captured as a startup id.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import get_matches_collection, get_meeting_notes_collection, get_users_collection
from app.models.schemas import (
    CohortResponse,
    CohortStartup,
    HealthHistoryEntry,
    HealthLogRequest,
    HealthLogResponse,
    HealthResponse,
)
from app.services.auth_dependency import get_current_user
from app.services.health import (
    HISTORY_LIMIT,
    HISTORY_STORE_LIMIT,
    NOTES_WINDOW,
    compute_health_score,
    compute_trend,
)
from app.services.matches import MEETING_STATUSES

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# --- helpers -----------------------------------------------------------------------

def _object_id(raw: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def _to_datetime(value: Any) -> Optional[datetime]:
    """Parse a stored timestamp (datetime - naive means UTC - or ISO string)."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    return None


def _iso(value: Any) -> Optional[str]:
    parsed = _to_datetime(value)
    if parsed is not None:
        return parsed.isoformat()
    return value if isinstance(value, str) and value else None


def _history(user_doc: Dict[str, Any]) -> List[HealthHistoryEntry]:
    entries: List[HealthHistoryEntry] = []
    for raw in (user_doc.get("health_history") or [])[-HISTORY_LIMIT:]:
        if not isinstance(raw, dict) or raw.get("score") is None:
            continue
        try:
            entries.append(HealthHistoryEntry(score=float(raw["score"]), timestamp=_iso(raw.get("timestamp"))))
        except (TypeError, ValueError):
            continue
    return entries


def _trend(user_doc: Dict[str, Any]) -> str:
    trend = user_doc.get("health_trend")
    return trend if trend in ("up", "down", "stable") else "stable"


def _linked_mentor_id(user_id: str) -> Optional[str]:
    object_id = _object_id(user_id)
    if object_id is None:
        return None
    try:
        doc = get_users_collection().find_one({"_id": object_id}, {"mentor_id": 1})
    except Exception:
        logger.exception("Failed to look up linked mentor for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")
    mentor_id = (doc or {}).get("mentor_id")
    return str(mentor_id) if mentor_id else None


def _find_match(match_id: str) -> Optional[Dict[str, Any]]:
    """Look a match up by its uuid `match_id`, falling back to the Mongo _id."""
    matches = get_matches_collection()
    try:
        doc = matches.find_one({"match_id": match_id})
        if doc is None:
            object_id = _object_id(match_id)
            if object_id is not None:
                doc = matches.find_one({"_id": object_id})
    except Exception:
        logger.exception("Failed to look up match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not load the match. Please try again shortly.")
    return doc


def _submitter_role(user: Dict[str, Any], match_doc: Dict[str, Any]) -> str:
    """'startup' / 'mentor' if the caller is a party to the match, else 403."""
    user_id = str(user.get("sub", ""))
    role = user.get("role")
    if role == "startup" and str(match_doc.get("user_id") or "") == user_id:
        return "startup"
    if role == "mentor":
        mentor_id = _linked_mentor_id(user_id)
        if mentor_id and str(match_doc.get("mentor_id") or "") == mentor_id:
            return "mentor"
    raise HTTPException(status_code=403, detail="You do not have access to this match.")


# --- endpoints ----------------------------------------------------------------------

@router.post("/health/log", response_model=HealthLogResponse)
async def log_meeting_outcome(request: HealthLogRequest, user=Depends(get_current_user)) -> HealthLogResponse:
    """Record a post-meeting outcome and recompute the startup's health score
    from its last 5 meeting notes."""
    match_doc = _find_match(request.match_id)
    if not match_doc:
        raise HTTPException(status_code=404, detail="Match not found.")
    submitted_by = _submitter_role(user, match_doc)

    startup_id = str(match_doc.get("user_id") or "")
    startup_object_id = _object_id(startup_id)
    if startup_object_id is None:
        raise HTTPException(status_code=409, detail="This match is not linked to a startup account.")

    users = get_users_collection()
    try:
        startup_doc = users.find_one({"_id": startup_object_id}, {"health_history": 1})
    except Exception:
        logger.exception("Failed to load startup %s", startup_id)
        raise HTTPException(status_code=502, detail="Could not log the outcome. Please try again shortly.")
    if not startup_doc:
        raise HTTPException(status_code=404, detail="Startup account no longer exists.")

    now = datetime.now(timezone.utc)
    note = {
        "match_id": match_doc.get("match_id") or str(match_doc["_id"]),
        "startup_id": startup_id,
        "mentor_id": str(match_doc.get("mentor_id") or ""),
        "timestamp": now,
        "momentum_score": request.momentum_score,
        "blockers_resolved": request.blockers_resolved,
        "mentor_engagement": request.mentor_engagement,
        "notes": (request.notes or "").strip(),
        "submitted_by": submitted_by,
    }

    notes_collection = get_meeting_notes_collection()
    try:
        notes_collection.insert_one(note)
        recent = list(
            notes_collection.find({"startup_id": startup_id}).sort("timestamp", -1).limit(NOTES_WINDOW)
        )
    except Exception:
        logger.exception("Failed to store meeting note for match %s", request.match_id)
        raise HTTPException(status_code=502, detail="Could not log the outcome. Please try again shortly.")

    health_score = compute_health_score(recent)
    previous = (startup_doc.get("health_history") or [None])[-1]
    previous_score = previous.get("score") if isinstance(previous, dict) else None
    trend = compute_trend(health_score, previous_score)

    try:
        users.update_one(
            {"_id": startup_object_id},
            {
                "$set": {"health_score": health_score, "health_trend": trend, "health_updated_at": now},
                "$push": {
                    "health_history": {
                        "$each": [{"score": health_score, "timestamp": now}],
                        "$slice": -HISTORY_STORE_LIMIT,
                    }
                },
            },
        )
        get_matches_collection().update_one(
            {"_id": match_doc["_id"]},
            {"$addToSet": {"health_logged_by": submitted_by}, "$set": {"health_logged_at": now.isoformat()}},
        )
    except Exception:
        logger.exception("Failed to update health score for startup %s", startup_id)
        raise HTTPException(
            status_code=502, detail="The outcome was logged but the health score could not be updated."
        )

    return HealthLogResponse(health_score=health_score, trend=trend)


@router.get("/health/cohort", response_model=CohortResponse)
async def cohort_health(user=Depends(get_current_user)) -> CohortResponse:
    """Coordinator view: every startup with its health and match activity."""
    if user.get("role") != "coordinator":
        raise HTTPException(status_code=403, detail="Only coordinator accounts can view the cohort.")

    try:
        startups = list(
            get_users_collection().find(
                {"$or": [{"role": "startup"}, {"role": {"$exists": False}}]},
                {"email": 1, "health_score": 1, "health_trend": 1, "health_history": 1, "health_updated_at": 1},
            )
        )
        user_ids = [str(doc["_id"]) for doc in startups]
        match_docs = list(
            get_matches_collection().find(
                {"user_id": {"$in": user_ids}},
                {"user_id": 1, "status": 1, "timestamp": 1, "updated_at": 1, "startup_profile": 1},
            )
        ) if user_ids else []
    except Exception:
        logger.exception("Failed to load cohort health")
        raise HTTPException(status_code=502, detail="Could not load the cohort. Please try again shortly.")

    by_user: Dict[str, List[Dict[str, Any]]] = {}
    for match in match_docs:
        by_user.setdefault(str(match.get("user_id")), []).append(match)

    rows: List[CohortStartup] = []
    for doc in startups:
        user_id = str(doc["_id"])
        user_matches = by_user.get(user_id, [])

        # Domain/stage come from the most recently created match's profile.
        latest = max(
            user_matches,
            key=lambda m: _to_datetime(m.get("timestamp")) or _EPOCH,
            default=None,
        )
        latest_profile: Dict[str, Any] = (latest or {}).get("startup_profile") or {}

        activity = [_to_datetime(doc.get("health_updated_at"))]
        for match in user_matches:
            activity += [_to_datetime(match.get("timestamp")), _to_datetime(match.get("updated_at"))]
        last_activity = max((a for a in activity if a is not None), default=None)

        score = doc.get("health_score")
        rows.append(
            CohortStartup(
                user_id=user_id,
                email=doc.get("email"),
                domain=latest_profile.get("domain"),
                stage=latest_profile.get("stage"),
                health_score=float(score) if score is not None else None,
                trend=_trend(doc),
                match_count=len(user_matches),
                meeting_count=sum(1 for m in user_matches if m.get("status") in MEETING_STATUSES),
                last_activity=last_activity.isoformat() if last_activity else None,
                health_history=_history(doc),
            )
        )

    # Lowest health first (who needs attention), unscored startups last.
    rows.sort(key=lambda r: (r.health_score is None, r.health_score or 0.0, r.email or ""))
    return CohortResponse(startups=rows)


@router.get("/health/{startup_id}", response_model=HealthResponse)
async def startup_health(startup_id: str, user=Depends(get_current_user)) -> HealthResponse:
    """A startup's health score, trend and last 10 history points."""
    caller_id = str(user.get("sub", ""))
    target_id = caller_id if startup_id == "me" else startup_id
    role = user.get("role")

    allowed = target_id == caller_id or role == "coordinator"
    if not allowed and role == "mentor":
        mentor_id = _linked_mentor_id(caller_id)
        if mentor_id:
            try:
                allowed = (
                    get_matches_collection().find_one(
                        {"user_id": target_id, "mentor_id": mentor_id}, {"_id": 1}
                    )
                    is not None
                )
            except Exception:
                logger.exception("Failed to check mentor %s access to startup %s", mentor_id, target_id)
                raise HTTPException(status_code=502, detail="Could not load the health score.")
    if not allowed:
        raise HTTPException(status_code=403, detail="You do not have access to this startup's health score.")

    object_id = _object_id(target_id)
    if object_id is None:
        raise HTTPException(status_code=404, detail="Startup not found.")
    try:
        doc = get_users_collection().find_one(
            {"_id": object_id},
            {"health_score": 1, "health_trend": 1, "health_history": 1, "health_updated_at": 1},
        )
    except Exception:
        logger.exception("Failed to load health for %s", target_id)
        raise HTTPException(status_code=502, detail="Could not load the health score. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="Startup not found.")

    score = doc.get("health_score")
    return HealthResponse(
        health_score=float(score) if score is not None else None,
        trend=_trend(doc),
        health_history=_history(doc),
        last_updated=_iso(doc.get("health_updated_at")),
    )
