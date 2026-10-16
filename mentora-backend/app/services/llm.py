"""
Groq LLM integration: sends extracted pitch-deck/startup text to Groq
(model configurable via GROQ_MODEL) and parses the response into a
StartupProfile, then (second call) asks for `deck_feedback` on how useful
that profile is for mentor matching.
"""
import json
import logging
from typing import Optional, get_args

from fastapi import HTTPException
from groq import Groq
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import MAX_STARTUP_SECTORS, DeckFeedback, MentorSector, StartupProfile

logger = logging.getLogger(__name__)

# The sector vocabulary mentors pick from at onboarding (MentorSector); the
# extraction is constrained to it so domain_match compares like with like.
SECTOR_CHOICES = list(get_args(MentorSector))
_SECTOR_LIST = ", ".join(f'"{sector}"' for sector in SECTOR_CHOICES)

SYSTEM_PROMPT = (
    "You are an expert startup analyst. You will be given raw text extracted "
    "from a startup's pitch deck or business document. Analyze it and return "
    "ONLY a single JSON object (no prose, no markdown fences, no explanation) "
    "with exactly these fields:\n"
    f'  "sectors": a list of 1 or 2 sectors, best fit first, each EXACTLY one of: {_SECTOR_LIST}. '
    'Use a second sector only when the startup clearly spans two (e.g. ["AgriTech", "FinTech"] '
    'for farm credit); AI/ML, robotics and hardware are "DeepTech", e-commerce and consumer '
    'brands are "D2C", climate/energy/EV are "Clean Energy". Use "Others" only if nothing fits.\n'
    '  "domain": the first entry of "sectors".\n'
    '  "stage": one of exactly "idea", "MVP", or "growth".\n'
    '  "challenges": a list of short strings describing the key challenges the '
    "startup currently faces.\n"
    '  "team_gaps": a list of short strings describing skill or role gaps in '
    "the founding team.\n"
    '  "geography": the city where the startup is based, as a plain city name '
    '(e.g. "Bangalore", "Mumbai", "London"), "Remote" if the team is fully remote, '
    "or null if the document does not say. Do not guess.\n"
    "Return valid JSON and nothing else."
)

# Used for the single retry after a response fails JSON/schema validation.
STRICT_SYSTEM_PROMPT = (
    "You are a JSON generator. Your previous answer could not be parsed. "
    "Output EXACTLY one JSON object and NOTHING else: no markdown, no code "
    "fences, no comments, no text before or after it.\n"
    "The object MUST have exactly these keys and types:\n"
    f'  "sectors": array of 1-2 strings, each exactly one of {_SECTOR_LIST}\n'
    '  "domain": string (non-empty), the first entry of "sectors"\n'
    '  "stage": string, one of exactly "idea", "MVP", "growth" (case-sensitive)\n'
    '  "challenges": array of strings (may be empty)\n'
    '  "team_gaps": array of strings (may be empty)\n'
    '  "geography": string city name, "Remote", or null\n'
    "Example of the required shape:\n"
    '{"sectors": ["HealthTech"], "domain": "HealthTech", "stage": "MVP", '
    '"challenges": ["Clinical validation"], "team_gaps": ["No CTO"], "geography": "Bangalore"}'
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
        return normalise_sectors(StartupProfile.model_validate(data))
    except ValidationError:
        return None


def normalise_sectors(profile: StartupProfile) -> StartupProfile:
    """Snap the LLM's `sectors` (or, if it gave none, its `domain`) onto the
    MentorSector vocabulary and keep `domain` == the first sector.

    Labels the vocabulary cannot place are dropped; if nothing is left the
    profile keeps its original free-text `domain` and empty `sectors`, so
    the extraction never fails over vocabulary.
    """
    # Local import: keeps this module importable without the embedding stack.
    from app.services.mentor_matching import canonical_domain

    sectors = []
    for label in list(profile.sectors) or [profile.domain]:
        canonical = canonical_domain(label)
        if canonical in SECTOR_CHOICES and canonical not in sectors:
            sectors.append(canonical)
    sectors = sectors[:MAX_STARTUP_SECTORS]
    if not sectors:
        return profile.model_copy(update={"sectors": []})
    return profile.model_copy(update={"sectors": sectors, "domain": sectors[0]})


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


# --- Deck feedback (second Groq call made by POST /extract) ------------------

FEEDBACK_SYSTEM_PROMPT = (
    "You are an expert startup analyst who evaluates how useful a startup "
    "profile is for mentor matching. Return ONLY a single valid JSON object."
)

FEEDBACK_PROMPT_TEMPLATE = """
Analyze this startup profile extracted from a pitch deck for mentor matching quality.
Profile: {profile_json}

Return ONLY valid JSON, no markdown, no explanation:
{{
  "confidence_score": <integer 0-100>,
  "strong_signals": [<string>, ...],
  "weak_signals": [<string>, ...],
  "improvement_tips": [<string max 3>, ...]
}}

confidence_score: how well a mentor could assess fit from this profile (0=nothing useful, 100=very detailed).
strong_signals: specific things that are clear (e.g. "Domain clearly identified as Clean Energy").
weak_signals: vague or missing info (e.g. "Team gaps not mentioned").
improvement_tips: specific actionable suggestions to improve mentor matching quality.
"""


def build_feedback_prompt(profile: StartupProfile) -> str:
    return FEEDBACK_PROMPT_TEMPLATE.format(profile_json=json.dumps(profile.model_dump()))


def _call_groq_feedback(prompt: str) -> str:
    """Single Groq call for deck feedback (JSON mode). Raises HTTPException
    on any failure, exactly like `_call_groq`; the caller falls back."""
    client = _get_client()
    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": FEEDBACK_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content
    except Exception as exc:
        logger.warning("Groq deck-feedback call failed: %s", exc)
        raise HTTPException(status_code=502, detail="Deck feedback is unavailable.") from exc
    if not content:
        raise HTTPException(status_code=502, detail="Groq API returned an empty response.")
    return content


def _load_json_object(raw_content: str) -> dict:
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        cleaned = raw_content.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("deck feedback must be a JSON object")
    return data


def generate_deck_feedback(profile: StartupProfile) -> DeckFeedback:
    """Ask Groq how useful `profile` is for mentor matching.

    Never raises: any failure (missing key, Groq error, malformed JSON,
    schema violation) is logged as a warning and the neutral default
    (confidence 60, empty lists) is returned, so /extract never fails
    because of feedback.
    """
    try:
        raw_content = _call_groq_feedback(build_feedback_prompt(profile))
        return DeckFeedback.model_validate(_load_json_object(raw_content))
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        logger.warning("Deck feedback unavailable, using the default: %s", str(detail)[:300])
        return DeckFeedback.default()
