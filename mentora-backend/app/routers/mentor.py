"""
PATCH /mentor/profile - completes / edits the calling mentor's profile
(the mentor onboarding flow) and re-embeds it so Atlas Vector Search
matches against the updated profile straight away.

Only users registered with role "mentor" may call it; the mentor document
edited is the one linked to their account via `users.mentor_id`.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import get_mentors_collection, get_users_collection
from app.models.schemas import MentorProfileUpdate, MentorProfileUpdateResponse
from app.services.auth_dependency import get_current_user
from app.services.embeddings import build_mentor_profile_text, embed_passage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mentor"])

# Concrete stages a mentor can focus on (as opposed to "all").
_CONCRETE_STAGES = ("idea", "MVP", "growth")


def derive_stage_focus(preferred_stages: List[str]) -> str:
    """The single stage if exactly one concrete stage was chosen, else "all"."""
    if "all" in preferred_stages:
        return "all"
    concrete = [stage for stage in preferred_stages if stage in _CONCRETE_STAGES]
    return concrete[0] if len(concrete) == 1 else "all"


def _load_user(user_id: str) -> Dict[str, Any]:
    try:
        object_id = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=401, detail="Invalid access token.")
    try:
        doc = get_users_collection().find_one({"_id": object_id}, {"password_hash": 0})
    except Exception:
        logger.exception("Failed to load user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="User account no longer exists.")
    return doc


@router.patch("/mentor/profile", response_model=MentorProfileUpdateResponse)
async def update_mentor_profile(
    request: MentorProfileUpdate, user=Depends(get_current_user)
) -> MentorProfileUpdateResponse:
    """Save the mentor's onboarding profile and re-embed it.

    `domain`, `expertise` and `stage_focus` are derived from the submitted
    sectors and preferred stages so the matching pipeline (which reads
    those fields) sees the new profile. Errors: 403 for non-mentor
    accounts, 404 if the account has no linked mentor document, 422 on
    invalid input, 502 if embedding or the database write fails.
    """
    if user.get("role") != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can edit a mentor profile.")

    user_id = str(user.get("sub", ""))
    user_doc = _load_user(user_id)

    try:
        mentor_object_id = ObjectId(str(user_doc.get("mentor_id") or ""))
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="No mentor profile is linked to this account.")

    mentors = get_mentors_collection()
    try:
        existing = mentors.find_one({"_id": mentor_object_id}, {"_id": 1})
    except Exception:
        logger.exception("Failed to load mentor %s", mentor_object_id)
        raise HTTPException(status_code=502, detail="Could not load your mentor profile. Please try again shortly.")
    if not existing:
        raise HTTPException(status_code=404, detail="No mentor profile is linked to this account.")

    stage_focus = derive_stage_focus(request.preferred_stages)
    profile: Dict[str, Any] = {
        **request.model_dump(),
        "domain": request.sector_expertise[0],
        "expertise": list(request.sector_expertise),
        "stage_focus": stage_focus,
    }

    text = build_mentor_profile_text(
        domain=profile["domain"],
        stage_focus=stage_focus,
        expertise=profile["expertise"],
        bio=request.bio,
        past_exits=request.past_exits,
        years_experience=request.years_experience,
    )
    try:
        embedding = embed_passage(text)
    except Exception as exc:
        logger.exception("Failed to embed updated profile for mentor %s", mentor_object_id)
        raise HTTPException(
            status_code=502,
            detail="Could not index your mentor profile for matching. Please try again shortly.",
        ) from exc

    now = datetime.now(timezone.utc).isoformat()
    try:
        mentors.update_one(
            {"_id": mentor_object_id},
            {
                "$set": {
                    **profile,
                    "email": user_doc.get("email"),
                    "embedding": embedding,
                    "onboarding_completed": True,
                    "updated_at": now,
                }
            },
        )
    except Exception as exc:
        logger.exception("Failed to update mentor %s", mentor_object_id)
        raise HTTPException(
            status_code=502, detail="Could not save your mentor profile. Please try again shortly."
        ) from exc

    try:
        get_users_collection().update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"profile": {**(user_doc.get("profile") or {}), **profile}, "updated_at": now}},
        )
    except Exception:
        # The mentor document (what matching reads) is already updated; a
        # stale copy on the user record is not worth failing the request.
        logger.exception("Failed to mirror mentor profile onto user %s", user_id)

    return MentorProfileUpdateResponse(
        success=True,
        mentor_id=str(mentor_object_id),
        profile={**profile, "onboarding_completed": True},
    )


# ---------------------------------------------------------------------------
# GET /mentor/matches  — incoming match requests for the signed-in mentor
# PATCH /mentor/matches/:match_id  — accept or decline a specific request
# ---------------------------------------------------------------------------

from datetime import datetime  # noqa: E402 (already imported above via timezone)
from typing import Optional  # noqa: E402

from fastapi import Query  # noqa: E402

from app.db.mongo import get_matches_collection  # noqa: E402


def _mentor_object_id_from_user(user_doc: dict) -> Optional[ObjectId]:
    """Return the mentors-collection ObjectId linked to this user, or None."""
    raw = user_doc.get("mentor_id")
    if not raw:
        return None
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def _jsonable_match(doc: dict) -> dict:
    """Serialize a match document so it is JSON-safe."""
    out = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            out[key] = str(value)
        elif isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


@router.get("/mentor/matches")
async def get_mentor_matches(
    status: Optional[str] = Query(default=None, description="Comma-separated status filter"),
    user=Depends(get_current_user),
) -> dict:
    """Return all match documents where `mentor_id` matches the signed-in mentor.

    Optional ?status=accepted,met filter (comma-separated). Only available to
    users registered with role "mentor".
    """
    if user.get("role") != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can view their match requests.")

    user_id = str(user.get("sub", ""))
    user_doc = _load_user(user_id)

    mentor_object_id = _mentor_object_id_from_user(user_doc)
    if mentor_object_id is None:
        return {"matches": []}

    mentor_id_str = str(mentor_object_id)
    query: dict = {"mentor_id": mentor_id_str}

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            query["status"] = {"$in": statuses}

    try:
        matches_col = get_matches_collection()
        docs = list(matches_col.find(query).sort("timestamp", -1))
    except Exception:
        logger.exception("Failed to load mentor matches for mentor %s", mentor_id_str)
        raise HTTPException(status_code=502, detail="Could not load your match requests. Please try again shortly.")

    return {"matches": [_jsonable_match(doc) for doc in docs]}


@router.patch("/mentor/matches/{match_id}")
async def update_mentor_match_status(
    match_id: str,
    body: dict,
    user=Depends(get_current_user),
) -> dict:
    """Accept or decline a specific match request.

    Body: { "status": "accepted" | "declined" }
    Only the mentor linked to that match may update it.
    """
    if user.get("role") != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can update match requests.")

    new_status = (body.get("status") or "").strip()
    if new_status not in ("accepted", "declined"):
        raise HTTPException(status_code=422, detail="status must be 'accepted' or 'declined'.")

    user_id = str(user.get("sub", ""))
    user_doc = _load_user(user_id)
    mentor_object_id = _mentor_object_id_from_user(user_doc)
    mentor_id_str = str(mentor_object_id) if mentor_object_id else None

    try:
        match_object_id = ObjectId(match_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Match not found.")

    matches_col = get_matches_collection()
    try:
        doc = matches_col.find_one({"_id": match_object_id})
    except Exception:
        logger.exception("Failed to find match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not load match. Please try again shortly.")

    if not doc:
        raise HTTPException(status_code=404, detail="Match not found.")

    # Authorise: only the mentor whose id is on the match may update it.
    if doc.get("mentor_id") != mentor_id_str:
        raise HTTPException(status_code=403, detail="You are not the mentor on this match.")

    try:
        matches_col.update_one(
            {"_id": match_object_id},
            {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        logger.exception("Failed to update match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not update match status. Please try again shortly.")

    return {"success": True, "status": new_status}
