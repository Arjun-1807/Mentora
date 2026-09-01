"""
Pydantic models shared across the API: request/response bodies for
/extract and /match, plus the internal mentor representation.
"""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

StartupStage = Literal["idea", "MVP", "growth"]
UserRole = Literal["startup", "mentor"]


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


class EmailRequest(BaseModel):
    """Request body for POST /email."""

    startup_profile: StartupProfile
    mentor: MentorMatch


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


class RegisterRequest(BaseModel):
    """Request body for POST /register."""

    email: EmailStr
    password: str
    role: UserRole
    profile: Dict = Field(default_factory=dict, description="Free-form profile data; see auth.py for expected keys")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
