"""
POST /email - drafts a short, professional intro email from a startup to a
matched mentor via Groq.

Rate-limited per authenticated user (each call costs Groq tokens) and, if
a `match_id` is supplied, advances that match record to status "emailed".
"""
import logging

from fastapi import APIRouter, Depends

from app.models.schemas import EmailRequest, EmailResponse
from app.services.auth_dependency import get_current_user
from app.services.email_gen import generate_intro_email
from app.services.matches import advance_match_status
from app.services.rate_limit import rate_limit_llm_for_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["email"])


@router.post("/email", response_model=EmailResponse)
async def draft_intro_email(request: EmailRequest, user=Depends(get_current_user)) -> EmailResponse:
    """Given a startup profile and a matched mentor, draft a short intro
    email from the startup to the mentor referencing the startup's
    challenges and the mentor's expertise.

    `match_id` is optional (either at the top level or on `mentor`); when
    present and owned by the caller, the match advances to status
    "emailed" so the dashboard's "Emails Sent" stat is real.
    """
    user_id = str(user.get("sub", ""))
    rate_limit_llm_for_user(user_id)

    email = generate_intro_email(request.startup_profile, request.mentor)

    match_id = request.match_id or request.mentor.match_id
    if match_id:
        advance_match_status(match_id, user_id, "emailed")

    return email
