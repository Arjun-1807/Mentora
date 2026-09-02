"""
Groq LLM integration: drafts a short, professional intro email from a
startup to a matched mentor, referencing the startup's challenges and the
mentor's expertise.

Uses settings.GROQ_MODEL (same model as app.services.llm) for consistency
with the rest of the app, rather than hard-coding a specific Groq model
string that may since have been deprecated.
"""
import json
import logging
from typing import Optional

from fastapi import HTTPException
from groq import Groq
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import EmailResponse, MentorMatch, StartupProfile

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are helping a startup founder write a short, professional introduction "
    "email to a mentor they have just been matched with. You will be given the "
    "startup's profile (domain, stage, challenges, team gaps) and the mentor's "
    "profile (name, domain, expertise). Write a concise, warm, professional email "
    "FROM the startup TO the mentor: introduce the startup briefly, reference 1-2 "
    "of the startup's specific challenges, explain why the mentor's expertise is "
    "relevant, and request a short introductory call. Keep it short (under 150 words).\n\n"
    "Return ONLY a single JSON object (no prose, no markdown fences) with exactly "
    'these fields:\n  "subject": a short, specific email subject line.\n  "body": '
    "the full email body text (plain text, may include line breaks).\n"
    "Return valid JSON and nothing else."
)


def _build_user_prompt(startup_profile: StartupProfile, mentor: MentorMatch) -> str:
    challenges = ", ".join(startup_profile.challenges) if startup_profile.challenges else "no specific challenges listed"
    expertise = ", ".join(mentor.expertise) if mentor.expertise else "general mentorship"
    return (
        f"Startup profile:\n"
        f"  Domain: {startup_profile.domain}\n"
        f"  Stage: {startup_profile.stage}\n"
        f"  Challenges: {challenges}\n"
        f"  Team gaps: {', '.join(startup_profile.team_gaps) if startup_profile.team_gaps else 'none specified'}\n\n"
        f"Mentor profile:\n"
        f"  Name: {mentor.name}\n"
        f"  Domain: {mentor.domain}\n"
        f"  Expertise: {expertise}\n\n"
        "Respond with only the JSON object described in the system prompt."
    )


def _get_client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not configured. Set it in your .env file.",
        )
    return Groq(api_key=settings.GROQ_API_KEY)


def _call_groq(startup_profile: StartupProfile, mentor: MentorMatch) -> str:
    client = _get_client()
    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(startup_profile, mentor)},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.exception("Groq API call failed")
        # Generic client-facing message; the full error is in the logs.
        raise HTTPException(
            status_code=502,
            detail="The language model service is temporarily unavailable. Please try again shortly.",
        ) from exc

    content = completion.choices[0].message.content
    if not content:
        raise HTTPException(status_code=502, detail="Groq API returned an empty response.")
    return content


def _parse_email(raw_content: str) -> Optional[EmailResponse]:
    """Try to parse raw LLM output into an EmailResponse. Returns None on failure."""
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        cleaned = raw_content.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return None

    try:
        return EmailResponse.model_validate(data)
    except ValidationError:
        return None


def generate_intro_email(startup_profile: StartupProfile, mentor: MentorMatch) -> EmailResponse:
    """Send startup + mentor context to Groq and return a validated EmailResponse.

    Retries once on malformed/invalid JSON before raising a clean HTTPException.
    """
    raw_content = _call_groq(startup_profile, mentor)
    email = _parse_email(raw_content)

    if email is None:
        logger.warning("First Groq response failed validation, retrying once. Raw: %s", raw_content[:500])
        raw_content_retry = _call_groq(startup_profile, mentor)
        email = _parse_email(raw_content_retry)

    if email is None:
        raise HTTPException(
            status_code=502,
            detail=(
                "Groq returned a response that could not be parsed into a valid "
                "email draft after one retry. Please try again."
            ),
        )

    return email
