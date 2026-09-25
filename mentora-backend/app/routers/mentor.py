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
