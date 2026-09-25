"""
Groq LLM integration: sends extracted pitch-deck/startup text to Groq
(model configurable via GROQ_MODEL) and parses the response into a
StartupProfile.
"""
import json
import logging
from typing import Optional

from fastapi import HTTPException
from groq import Groq
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import StartupProfile

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are an expert startup analyst. You will be given raw text extracted "
    "from a startup's pitch deck or business document. Analyze it and return "
    "ONLY a single JSON object (no prose, no markdown fences, no explanation) "
    "with exactly these fields:\n"
    '  "domain": a short string naming the industry/domain, e.g. "Fintech", '
    '"HealthTech", "EdTech", "SaaS", "E-commerce", "AI/ML", "Climate Tech".\n'
    '  "stage": one of exactly "idea", "MVP", or "growth".\n'
    '  "challenges": a list of short strings describing the key challenges the '
    "startup currently faces.\n"
    '  "team_gaps": a list of short strings describing skill or role gaps in '
    "the founding team.\n"
    "Return valid JSON and nothing else."
)

# Used for the single retry after a response fails JSON/schema validation.
STRICT_SYSTEM_PROMPT = (
    "You are a JSON generator. Your previous answer could not be parsed. "
    "Output EXACTLY one JSON object and NOTHING else: no markdown, no code "
    "fences, no comments, no text before or after it.\n"
    "The object MUST have exactly these four keys and types:\n"
    '  "domain": string (non-empty), e.g. "Fintech"\n'
    '  "stage": string, one of exactly "idea", "MVP", "growth" (case-sensitive)\n'
    '  "challenges": array of strings (may be empty)\n'
    '  "team_gaps": array of strings (may be empty)\n'
    "Example of the required shape:\n"
    '{"domain": "HealthTech", "stage": "MVP", "challenges": ["Clinical '
    'validation"], "team_gaps": ["No CTO"]}'
)

# Client-facing message when both attempts fail validation.
UNPARSEABLE_PROFILE_MESSAGE = (
    "We couldn't turn this deck into a structured startup profile. "
    "Please try again, or upload a more detailed deck."
)


def _build_user_prompt(text: str) -> str:
    # Truncate very long documents to keep the request within model context limits.
    max_chars = 12000
    truncated = text[:max_chars]
    return (
        "Here is the extracted startup document text:\n\n"
        f"{truncated}\n\n"
        "Respond with only the JSON object described in the system prompt."
    )


def _get_client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not configured. Set it in your .env file.",
        )
    return Groq(api_key=settings.GROQ_API_KEY)


def _call_groq(text: str, system_prompt: str = SYSTEM_PROMPT, temperature: float = 0.2) -> str:
    client = _get_client()
    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": _build_user_prompt(text)},
            ],
            temperature=temperature,
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


def _parse_profile(raw_content: str) -> Optional[StartupProfile]:
    """Try to parse raw LLM output into a StartupProfile. Returns None on failure."""
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        # Defensive fallback: some models wrap JSON in markdown fences despite instructions.
        cleaned = raw_content.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return None

    try:
        return StartupProfile.model_validate(data)
    except ValidationError:
        return None


def extract_startup_profile(text: str) -> StartupProfile:
    """Send extracted document text to Groq and return a validated StartupProfile.

    If the first response fails JSON/schema validation, retries exactly
    once with STRICT_SYSTEM_PROMPT at temperature 0; if that also fails,
    raises a 500 (the model misbehaved - not the client's fault).
    """
    raw_content = _call_groq(text)
    profile = _parse_profile(raw_content)

    if profile is None:
        logger.warning(
            "First Groq response failed validation, retrying once with the strict prompt. Raw: %s",
            raw_content[:500],
        )
        raw_content_retry = _call_groq(text, system_prompt=STRICT_SYSTEM_PROMPT, temperature=0.0)
        profile = _parse_profile(raw_content_retry)
        if profile is None:
            logger.error(
                "Strict-prompt retry also failed validation. Raw: %s", raw_content_retry[:500]
            )

    if profile is None:
        raise HTTPException(status_code=500, detail=UNPARSEABLE_PROFILE_MESSAGE)

    return profile
