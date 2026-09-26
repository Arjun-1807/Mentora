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

# Single client-facing message for every way email generation can fail
# (missing key, Groq outage, unusable output). The real cause is logged.
EMAIL_UNAVAILABLE_MESSAGE = "Email generation unavailable. Please try again."


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail=EMAIL_UNAVAILABLE_MESSAGE)


SYSTEM_PROMPT = (
    "You are helping a startup founder write a short, professional introduction "
    "email to a mentor they have just been matched with. You will be given the "
    "startup's profile (domain, stage, challenges, team gaps), the founder's name, "
    "and the mentor's profile (name, domain, expertise). Write a concise, warm, professional email "
    "FROM the startup TO the mentor: introduce the startup briefly, reference 1-2 "
    "of the startup's specific challenges, explain why the mentor's expertise is "
    "relevant, and request a short introductory call. Keep it short (under 150 words).\n\n"
    "CRITICAL REQUIREMENTS:\n"
    "- Address the email to the mentor by their specific name.\n"
    "- Sign off the email using the founder's specific name.\n"
    "- At the very bottom of the email body, add this exact sentence on a new line: 'This email is sent by Mentora.'\n\n"
    "Return ONLY a single JSON object (no prose, no markdown fences) with exactly "
    'these fields:\n  "subject": a short, specific email subject line.\n  "body": '
    "the full email body text (plain text, may include line breaks).\n"
    "Return valid JSON and nothing else."
)


def _build_user_prompt(startup_profile: StartupProfile, mentor: MentorMatch, founder_name: str) -> str:
    challenges = ", ".join(startup_profile.challenges) if startup_profile.challenges else "no specific challenges listed"
    expertise = ", ".join(mentor.expertise) if mentor.expertise else "general mentorship"
    return (
        f"Founder name: {founder_name}\n\n"
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
        logger.error("Email generation requested but GROQ_API_KEY is not configured")
        raise _unavailable()
    return Groq(api_key=settings.GROQ_API_KEY)


def _call_groq(startup_profile: StartupProfile, mentor: MentorMatch, founder_name: str) -> str:
    client = _get_client()
    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(startup_profile, mentor, founder_name)},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.exception("Groq API call failed while drafting an intro email")
        # Generic client-facing message; the full error is in the logs.
        raise _unavailable() from exc

    try:
        content = completion.choices[0].message.content
    except (AttributeError, IndexError, TypeError) as exc:
        logger.exception("Groq returned an unexpected response shape for an intro email")
        raise _unavailable() from exc
    if not content:
        logger.error("Groq returned an empty response for an intro email")
        raise _unavailable()
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


def generate_intro_email(startup_profile: StartupProfile, mentor: MentorMatch, founder_name: str) -> EmailResponse:
    """Send startup + mentor context to Groq and return a validated EmailResponse.

    Retries once on malformed/invalid JSON. Any failure (missing key, Groq
    error, unusable output) surfaces as a 503 with a generic message.
    """
    raw_content = _call_groq(startup_profile, mentor, founder_name)
    email = _parse_email(raw_content)

    if email is None:
        logger.warning("First Groq response failed validation, retrying once. Raw: %s", raw_content[:500])
        raw_content_retry = _call_groq(startup_profile, mentor, founder_name)
        email = _parse_email(raw_content_retry)

    if email is None:
        logger.error("Groq intro-email response failed validation after one retry")
        raise _unavailable()

    return email
