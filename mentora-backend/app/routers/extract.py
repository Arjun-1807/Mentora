"""
POST /extract - accepts a pitch-deck PDF, extracts its text, and asks
Groq to structure it into a StartupProfile.
"""
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import ExtractResponse
from app.services.llm import extract_startup_profile
from app.services.pdf_extract import extract_text_from_pdf

router = APIRouter(tags=["extract"])


@router.post("/extract", response_model=ExtractResponse)
async def extract_startup_info(file: UploadFile = File(...)) -> ExtractResponse:
    """Upload a startup pitch deck / document as a PDF and receive a
    structured JSON profile: domain, stage, challenges, team_gaps."""
    if file is None:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    text = await extract_text_from_pdf(file)
    profile = extract_startup_profile(text)

    return ExtractResponse(**profile.model_dump())
