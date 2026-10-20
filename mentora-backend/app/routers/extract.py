"""
POST /extract - accepts a pitch-deck PDF, extracts its text, and asks
Groq to structure it into a StartupProfile. A second Groq call then adds
`deck_feedback` (confidence score + signals + tips); that call can never
fail the request (it falls back to a neutral default).

Rate-limited per authenticated user: the endpoint costs Groq tokens on
every call.
"""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.schemas import ExtractResponse
from app.services.auth_dependency import get_current_user
from app.services.llm import extract_startup_profile, generate_deck_feedback
from app.services.pdf_extract import extract_text_from_pdf
from app.services.rate_limit import rate_limit_llm_for_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["extract"])


@router.post("/extract", response_model=ExtractResponse)
async def extract_startup_info(file: UploadFile = File(...), user=Depends(get_current_user)) -> ExtractResponse:
    """Upload a startup pitch deck / document as a PDF and receive a
    structured JSON profile: domain, stage, challenges, team_gaps."""
    if file is None:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    rate_limit_llm_for_user(str(user.get("sub", "")))

    text = await extract_text_from_pdf(file)
    profile = extract_startup_profile(text)
    deck_feedback = generate_deck_feedback(profile)

    return ExtractResponse(**profile.model_dump(), deck_feedback=deck_feedback)
