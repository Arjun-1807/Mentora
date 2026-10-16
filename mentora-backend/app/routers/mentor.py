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
# GET /mentor/matches  — the signed-in mentor's intro requests (requested+)
# PATCH /mentor/matches/:match_id  — accept or decline a request
# ---------------------------------------------------------------------------

from typing import Optional  # noqa: E402

from fastapi import Query  # noqa: E402

from app.db.mongo import get_matches_collection  # noqa: E402
from app.services import matches as match_service  # noqa: E402
from app.services.auth_dependency import Principal, get_principal  # noqa: E402
from app.services.mailer import frontend_url, notify  # noqa: E402


@router.get("/mentor/matches")
async def get_mentor_matches(
    status: Optional[str] = Query(default=None, description="Comma-separated status filter"),
    principal: Principal = Depends(get_principal),
) -> dict:
    """The signed-in mentor's matches from `requested` on (never `suggested`
    or `superseded`: those are the startup's private shortlist).

    Optional ?status=requested,accepted filter (legacy spellings accepted),
    intersected with what a mentor may see. Each item carries `company_name`
    and `startup_summary`; `startup_email` is only filled in from `accepted`
    on. Requests older than the TTL are expired first.
    """
    if principal.role != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can view their match requests.")
    if not principal.mentor_id:
        return {"matches": []}

    visible = list(match_service.REQUESTED_OR_LATER)
    if status:
        wanted = {match_service.normalise_status(s.strip()) for s in status.split(",") if s.strip()}
        visible = [s for s in visible if s in wanted]
        if not visible:
            return {"matches": []}

    scope = {"mentor_id": principal.mentor_id}
    try:
        match_service.expire_stale_requests(scope)
        docs = list(
            get_matches_collection()
            .find({**scope, "status": match_service.status_in(visible), "duplicate_of": {"$exists": False}})
            .sort("timestamp", -1)
        )
    except Exception:
        logger.exception("Failed to load mentor matches for mentor %s", principal.mentor_id)
        raise HTTPException(status_code=502, detail="Could not load your match requests. Please try again shortly.")

    return {"matches": match_service.mentor_view(docs)}


def _notify_startup(doc: dict, decision: str) -> None:
    """Tell the startup its request was accepted / declined (best effort)."""
    owner = None
    try:
        owner = get_users_collection().find_one({"_id": ObjectId(str(doc.get("user_id")))}, {"email": 1})
    except (InvalidId, TypeError):
        owner = None
    except Exception:
        logger.exception("Failed to load the startup owner of match %s", doc.get("match_id"))
    if not owner or not owner.get("email"):
        return
    mentor = doc.get("mentor_name") or "The mentor"
    link = frontend_url("/matches")
    if decision == match_service.ACCEPTED:
        subject = f"{mentor} accepted your intro request"
        body = (
            f"Good news: {mentor} accepted your introduction request on Mentora.\n\n"
            f"Book a meeting with them here: {link}\n"
        )
    else:
        replacement = get_matches_collection().find_one({"replacement_for": doc.get("match_id")}, {"_id": 1})
        subject = f"{mentor} declined your intro request"
        body = (
            f"{mentor} isn't able to take on your request right now.\n\n"
            + ("We've added a new mentor suggestion to your matches: " if replacement else "See your other matches: ")
            + f"{link}\n"
        )
    notify(to=owner["email"], subject=subject, body=body, kind=f"request_{decision}", match_id=doc.get("match_id"))


@router.patch("/mentor/matches/{match_id}")
async def update_mentor_match_status(
    match_id: str,
    body: dict,
    principal: Principal = Depends(get_principal),
) -> dict:
    """Accept or decline an intro request (uuid `match_id` or Mongo `_id`).

    Body: { "status": "accepted" | "declined" }. Goes through the lifecycle
    state machine, so only a `requested` match can be answered (a match can
    never move backwards); repeating the same answer is a no-op 200.
    Errors: 403 not your match, 404 unknown, 409 not answerable, 422 bad status.
    """
    if principal.role != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can update match requests.")

    new_status = (body.get("status") or "").strip() if isinstance(body, dict) else ""
    if new_status not in (match_service.ACCEPTED, match_service.DECLINED):
        raise HTTPException(status_code=422, detail="status must be 'accepted' or 'declined'.")

    try:
        doc = match_service.find_match(match_id)
    except Exception:
        logger.exception("Failed to find match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not load match. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="Match not found.")
    if not principal.mentor_id or str(doc.get("mentor_id") or "") != principal.mentor_id:
        raise HTTPException(status_code=403, detail="You are not the mentor on this match.")

    current = match_service.normalise_status(doc.get("status"))
    if current == new_status:
        return {"success": True, "status": new_status, "match_id": doc.get("match_id")}
    if current not in match_service.REQUESTED_OR_LATER:
        # Suggestions are invisible to mentors; answer as if it didn't exist.
        raise HTTPException(status_code=404, detail="Match not found.")

    try:
        updated = match_service.transition_match(
            doc.get("match_id") or doc["_id"], match_service.MENTOR, principal.user_id, new_status, doc=doc
        )
    except match_service.TransitionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception:
        logger.exception("Failed to update match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not update match status. Please try again shortly.")

    _notify_startup(updated, new_status)
    return {"success": True, "status": new_status, "match_id": updated.get("match_id")}
