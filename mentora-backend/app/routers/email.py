"""
POST /email - drafts a short, professional intro email from a startup to a
matched mentor via Groq.
"""
from fastapi import APIRouter, Depends

from app.models.schemas import EmailRequest, EmailResponse
from app.services.auth_dependency import get_current_user
from app.services.email_gen import generate_intro_email

router = APIRouter(tags=["email"])


@router.post("/email", response_model=EmailResponse)
async def draft_intro_email(request: EmailRequest, user=Depends(get_current_user)) -> EmailResponse:
    """Given a startup profile and a matched mentor, draft a short intro
    email from the startup to the mentor referencing the startup's
    challenges and the mentor's expertise."""
    return generate_intro_email(request.startup_profile, request.mentor)
