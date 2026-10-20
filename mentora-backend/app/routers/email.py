"""
POST /email - drafts a short, professional intro email from a startup to a
matched mentor via Groq.

Rate-limited per authenticated user (each call costs Groq tokens). This only
drafts: nothing is sent and the match status does not change. Sending (and
the move to `requested`) is POST /matches/{match_id}/request.
"""
import logging

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import get_users_collection
from app.models.schemas import EmailRequest, EmailResponse, StartupProfile
from app.services import startups as startup_service
from app.services.auth_dependency import get_current_user
from app.services.email_gen import generate_intro_email
from app.services.rate_limit import rate_limit_llm_for_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["email"])


@router.post("/email", response_model=EmailResponse)
async def draft_intro_email(request: EmailRequest, user=Depends(get_current_user)) -> EmailResponse:
    """Given a startup profile and a matched mentor, draft a short intro
    email from the startup to the mentor referencing the startup's
    challenges and the mentor's expertise.

    `startup_profile` defaults to the caller's active profile (so the
    dashboard can draft without a local copy). `match_id` is accepted for
    compatibility and ignored.
    """
    user_id = str(user.get("sub", ""))
    rate_limit_llm_for_user(user_id)

    # Fetch founder's name from the DB
    try:
        user_doc = get_users_collection().find_one({"_id": ObjectId(user_id)}, {"profile.name": 1})
        founder_name = user_doc.get("profile", {}).get("name", "Founder") if user_doc else "Founder"
    except Exception:
        logger.exception("Failed to look up founder name for user %s", user_id)
        founder_name = "Founder"

    profile = request.startup_profile
    if profile is None:
        try:
            active = startup_service.get_active_profile(startup_service.get_startup_by_owner(user_id))
        except Exception:
            logger.exception("Failed to load the active profile for %s", user_id)
            active = None
        if not active:
            raise HTTPException(status_code=409, detail="Upload a pitch deck first so we can draft your intro.")
        profile = StartupProfile.model_validate(active["profile"])

    return generate_intro_email(profile, request.mentor, founder_name)
