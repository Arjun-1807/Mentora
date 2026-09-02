"""
Pydantic models shared across the API: request/response bodies for
/extract, /match, /email, /feedback and the auth endpoints, plus the
internal mentor representation.
"""
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

StartupStage = Literal["idea", "MVP", "growth"]
UserRole = Literal["startup", "mentor"]

# Match lifecycle vocabulary (see README "Match status lifecycle"):
#   pending   -> created by POST /match, no outreach yet
#   emailed   -> an intro email was drafted for it via POST /email
#   completed -> feedback was submitted for it via POST /feedback
MatchStatus = Literal["pending", "emailed", "completed"]

# Minimum password length enforced at registration.
MIN_PASSWORD_LENGTH = 8
# bcrypt truncates/rejects beyond 72 bytes; we reject explicitly instead.
MAX_PASSWORD_BYTES = 72


class StartupProfile(BaseModel):
    """Structured startup profile, as produced by /extract and consumed by /match."""

    domain: str = Field(..., description="Industry/domain, e.g. 'Fintech', 'HealthTech'")
    stage: StartupStage = Field(..., description="Startup stage: idea, MVP, or growth")
    challenges: List[str] = Field(default_factory=list, description="Key challenges the startup is facing")
    team_gaps: List[str] = Field(default_factory=list, description="Skill/role gaps in the founding team")
    geography: Optional[str] = Field(default=None, description="Startup's geography, e.g. 'San Francisco, CA'")


class ExtractResponse(StartupProfile):
    """Response body for POST /extract. Same shape as StartupProfile today,
    kept as a distinct model so the API contract can evolve independently."""
    pass


class MentorMatch(BaseModel):
    """A single mentor match result returned by POST /match."""

    mentor_id: str = Field(..., description="Mentor's MongoDB _id as a string")
    name: str
    domain: str
    stage_focus: str
    expertise: List[str]
    match_score: float = Field(
        ..., description="Weighted match score in the 0-1 range (see mentor_matching.py for the formula)"
    )
    match_id: Optional[str] = Field(
        default=None, description="Id of the persisted match record; pass to /email and /feedback"
    )


class MatchResponse(BaseModel):
    matches: List[MentorMatch]


class MentorDocument(BaseModel):
    """Shape of a mentor document as stored in / read from MongoDB."""

    name: str
    domain: str
    stage_focus: StartupStage
    expertise: List[str]
    embedding: Optional[List[float]] = None
    geography: Optional[str] = None
    effectiveness_score: Optional[float] = Field(
        default=None, description="Rolling average (1-5) of feedback ratings for this mentor"
    )


class MentorListItem(BaseModel):
    """Public mentor directory entry returned by GET /mentors.

    Deliberately excludes the `embedding` field, which is large and of no
    use to clients.
    """

    mentor_id: str
    name: str
    domain: str
    stage_focus: str
    expertise: List[str] = Field(default_factory=list)
    geography: Optional[str] = None
    effectiveness_score: Optional[float] = None
    feedback_count: int = 0


class MentorListResponse(BaseModel):
    mentors: List[MentorListItem]
    total: int


class MentorProfileIn(BaseModel):
    """Validated mentor registration profile (the `profile` object of
    POST /register when `role == "mentor"`)."""

    name: str = Field(..., min_length=1, description="Mentor's display name")
    domain: str = Field(..., min_length=1, description="Mentor's domain, e.g. 'Fintech'")
    stage_focus: StartupStage = Field(..., description="Stage the mentor focuses on: idea, MVP, or growth")
    expertise: List[str] = Field(..., min_length=1, description="At least one expertise area")
    sector_expertise: Optional[str] = None
    past_exits: Optional[Any] = None
    geography: Optional[str] = None
    availability: Optional[Any] = None

    @field_validator("expertise")
    @classmethod
    def _non_empty_expertise(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if not cleaned:
            raise ValueError("expertise must contain at least one non-empty entry")
        return cleaned


class EmailRequest(BaseModel):
    """Request body for POST /email."""

    startup_profile: StartupProfile
    mentor: MentorMatch
    match_id: Optional[str] = Field(
        default=None,
        description="Optional id of the match record to advance to status 'emailed'.",
    )


class EmailResponse(BaseModel):
    """Response body for POST /email."""

    subject: str
    body: str


class FeedbackRequest(BaseModel):
    """Request body for POST /feedback."""

    match_id: str
    mentor_id: str
    attended: bool
    rating: int = Field(..., ge=1, le=5)


class FeedbackResponse(BaseModel):
    success: bool
    new_effectiveness_score: float


class MentorFeedbackStats(BaseModel):
    """Aggregate feedback stats for one mentor (GET /feedback/summary)."""

    mentor_id: str
    name: Optional[str] = None
    feedback_count: int
    average_rating: float
    attended_count: int


class FeedbackSummaryResponse(BaseModel):
    mentors: List[MentorFeedbackStats]


class RegisterRequest(BaseModel):
    """Request body for POST /register."""

    email: EmailStr
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH)
    role: UserRole
    profile: Dict = Field(default_factory=dict, description="Free-form profile data; see auth.py for expected keys")

    @field_validator("password")
    @classmethod
    def _password_within_bcrypt_limit(cls, value: str) -> str:
        # bcrypt (4.x/5.x) raises on inputs longer than 72 bytes, so reject
        # them here with a clear 422 instead of 500-ing deeper in the stack.
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(
                f"password must be at most {MAX_PASSWORD_BYTES} bytes long (bcrypt limit)"
            )
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    """Response body for GET /me. Never includes the password hash."""

    user_id: str
    email: EmailStr
    role: UserRole
    profile: Dict = Field(default_factory=dict)
    mentor_id: Optional[str] = Field(
        default=None, description="Linked mentors-collection _id, for users registered as mentors"
    )
    created_at: Optional[str] = None
