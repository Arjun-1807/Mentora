"""
Startup health score endpoints (see app/services/health.py for the formula).

POST /health/log           (JWT; the startup owning the match or its mentor)
GET  /health/cohort        (JWT; coordinator only - startups in the
                            coordinator's own cohorts)
GET  /health/{startup_id}  (JWT; the startup itself, a coordinator of one of
                            its cohorts, or a mentor matched with that
                            startup; "me" = caller)

`/health/cohort` is declared before `/health/{startup_id}` so "cohort" is
never captured as a startup id.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import (
    get_matches_collection,
    get_meeting_notes_collection,
    get_startup_profiles_collection,
    get_startups_collection,
    get_users_collection,
)
from app.models.schemas import (
    CohortResponse,
    CohortStartup,
    HealthHistoryEntry,
    HealthLogRequest,
    HealthLogResponse,
    HealthResponse,
)
from app.services.auth_dependency import Principal, get_current_user, get_principal
from app.services.health import (
    HISTORY_LIMIT,
    HISTORY_STORE_LIMIT,
    NOTES_WINDOW,
    compute_health_score,
    compute_trend,
)
from app.services import matches as match_service
from app.services.matches import MEETING_STATUSES, VISIBLE_FILTER, normalise_status
from app.services.tenancy import cohort_member_query, user_in_cohorts

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
    status = match_service.normalise_status(match_doc.get("status"))
    if status not in match_service.OUTCOME_STATUSES:
        raise HTTPException(
            status_code=409, detail="An outcome can only be logged once a meeting has been scheduled."
        )

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

    if status == match_service.MEETING_SCHEDULED:
        # The first outcome log means the meeting happened.
        try:
            match_service.transition_match(
                match_doc.get("match_id") or match_doc["_id"],
                submitted_by,
                str(user.get("sub", "")),
                match_service.MET,
            )
        except match_service.TransitionError:
            pass
        except Exception:
            logger.exception("Failed to mark match %s as met", match_doc.get("match_id"))

    return HealthLogResponse(health_score=health_score, trend=trend)


@router.get("/health/cohort", response_model=CohortResponse)
async def cohort_health(principal: Principal = Depends(get_principal)) -> CohortResponse:
    """Coordinator view: the startups in the caller's cohorts, with their
    health and match activity. Other cohorts' startups are never returned."""
    if not principal.is_coordinator:
        raise HTTPException(status_code=403, detail="Only coordinator accounts can view the cohort.")

    try:
        startups = list(
            get_users_collection().find(
                {
                    "$and": [
                        {"$or": [{"role": "startup"}, {"role": {"$exists": False}}]},
                        cohort_member_query(principal.cohort_ids),
                    ]
                },
                {"email": 1, "health_score": 1, "health_trend": 1, "health_history": 1, "health_updated_at": 1},
            )
        )
        user_ids = [str(doc["_id"]) for doc in startups]
        match_docs = list(
            get_matches_collection().find(
                {"user_id": {"$in": user_ids}, **VISIBLE_FILTER},
                {"user_id": 1, "status": 1, "timestamp": 1, "updated_at": 1, "startup_profile": 1},
            )
        ) if user_ids else []
        startup_docs = {
            doc["owner_user_id"]: doc
            for doc in get_startups_collection().find({"owner_user_id": {"$in": user_ids}})
        } if user_ids else {}
        profile_ids = [d["active_profile_id"] for d in startup_docs.values() if d.get("active_profile_id")]
        active_profiles = {
            doc["_id"]: doc.get("profile") or {}
            for doc in get_startup_profiles_collection().find({"_id": {"$in": profile_ids}}, {"profile": 1})
        } if profile_ids else {}
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
        startup_doc = startup_docs.get(user_id) or {}
        latest_profile = active_profiles.get(startup_doc.get("active_profile_id")) or latest_profile

        activity = [_to_datetime(doc.get("health_updated_at"))]
        for match in user_matches:
            activity += [_to_datetime(match.get("timestamp")), _to_datetime(match.get("updated_at"))]
        last_activity = max((a for a in activity if a is not None), default=None)

        score = doc.get("health_score")
        rows.append(
            CohortStartup(
                user_id=user_id,
                email=doc.get("email"),
                company_name=startup_doc.get("company_name"),
                domain=latest_profile.get("domain"),
                stage=latest_profile.get("stage"),
                health_score=float(score) if score is not None else None,
                trend=_trend(doc),
                match_count=len(user_matches),
                meeting_count=sum(1 for m in user_matches if normalise_status(m.get("status")) in MEETING_STATUSES),
                last_activity=last_activity.isoformat() if last_activity else None,
                health_history=_history(doc),
            )
        )

    # Lowest health first (who needs attention), unscored startups last.
    rows.sort(key=lambda r: (r.health_score is None, r.health_score or 0.0, r.email or ""))
    return CohortResponse(startups=rows)


@router.get("/health/{startup_id}", response_model=HealthResponse)
async def startup_health(startup_id: str, principal: Principal = Depends(get_principal)) -> HealthResponse:
    """A startup's health score, trend and last 10 history points."""
    caller_id = principal.user_id
    target_id = caller_id if startup_id == "me" else startup_id
    role = principal.role

    allowed = target_id == caller_id
    if not allowed and role == "coordinator":
        # Coordinators only see startups in their own cohorts. An unknown id
        # is a 404, a startup in another cohort a 403.
        target_oid = _object_id(target_id)
        try:
            target = (
                get_users_collection().find_one(
                    {"_id": target_oid}, {"org_id": 1, "cohort_id": 1, "cohort_ids": 1}
                )
                if target_oid is not None
                else None
            )
        except Exception:
            logger.exception("Failed to check coordinator access to startup %s", target_id)
            raise HTTPException(status_code=502, detail="Could not load the health score.")
        if target is None:
            raise HTTPException(status_code=404, detail="Startup not found.")
        allowed = user_in_cohorts(target, principal.cohort_ids)
    if not allowed and role == "mentor":
        mentor_id = _linked_mentor_id(caller_id)
        if mentor_id:
            try:
                allowed = (
                    get_matches_collection().find_one(
                        {
                            "user_id": target_id,
                            "mentor_id": mentor_id,
                            # A suggestion the startup never acted on grants nothing.
                            "status": match_service.status_in(match_service.REQUESTED_OR_LATER),
                        },
                        {"_id": 1},
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
