"""
Pydantic models shared across the API: request/response bodies for
/extract and /match, plus the internal mentor representation.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

StartupStage = Literal["idea", "MVP", "growth"]


class StartupProfile(BaseModel):
    """Structured startup profile, as produced by /extract and consumed by /match."""

    domain: str = Field(..., description="Industry/domain, e.g. 'Fintech', 'HealthTech'")
    stage: StartupStage = Field(..., description="Startup stage: idea, MVP, or growth")
    challenges: List[str] = Field(default_factory=list, description="Key challenges the startup is facing")
    team_gaps: List[str] = Field(default_factory=list, description="Skill/role gaps in the founding team")


class ExtractResponse(StartupProfile):
    """Response body for POST /extract. Same shape as StartupProfile today,
    kept as a distinct model so the API contract can evolve independently."""
    pass


class MentorMatch(BaseModel):
    """A single mentor match result returned by POST /match."""

    name: str
    domain: str
    stage_focus: str
    expertise: List[str]
    match_score: float = Field(
        ..., description="Similarity score in the 0-1 range (cosine similarity + weighted boosts, clamped to 1.0)"
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
