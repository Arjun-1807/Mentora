"""
POST /extract - accepts a pitch-deck PDF, extracts its text, and asks
Groq to structure it into a StartupProfile. A second Groq call then adds
`deck_feedback` (confidence score + signals + tips); that call can never
fail the request (it falls back to a neutral default).

For startup accounts the result is saved as a new version in
`startup_profiles` (source "deck", with deck_feedback and the file name)
and becomes the startup's active profile, which POST /match then uses.

Rate-limited per authenticated user: the endpoint costs Groq tokens on
every call.
"""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.schemas import ExtractResponse
from app.routers.startup import require_startup
from app.services import startups as startup_service
from app.services.auth_dependency import Principal, get_principal
from app.services.llm import extract_startup_profile, generate_deck_feedback
from app.services.pdf_extract import extract_text_from_pdf
from app.services.rate_limit import rate_limit_llm_for_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["extract"])

MAX_FILENAME_LENGTH = 200


@router.post("/extract", response_model=ExtractResponse)
async def extract_startup_info(
    file: UploadFile = File(...), principal: Principal = Depends(get_principal)
) -> ExtractResponse:
    """Upload a startup pitch deck / document as a PDF and receive a
    structured JSON profile: domain, stage, challenges, team_gaps."""
    if file is None:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    rate_limit_llm_for_user(principal.user_id)

    text = await extract_text_from_pdf(file)
    profile = extract_startup_profile(text)
    deck_feedback = generate_deck_feedback(profile)
    response = ExtractResponse(**profile.model_dump(), deck_feedback=deck_feedback)

    if principal.role == "startup":
        startup = require_startup(principal)
        try:
            version = startup_service.save_profile_version(
                startup,
                profile.model_dump(),
                source=startup_service.SOURCE_DECK,
                created_by=principal.user_id,
                deck_feedback=deck_feedback.model_dump(),
                deck_filename=(file.filename or "")[:MAX_FILENAME_LENGTH] or None,
            )
        except Exception:
            logger.exception("Failed to save the extracted profile for %s", principal.user_id)
            raise HTTPException(status_code=502, detail="Could not save your profile. Please try again shortly.")
        response.profile_id = str(version["_id"])
        response.version = version["version"]
        response.startup_id = str(startup["_id"])

    return response
