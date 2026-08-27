"""
POST /match - accepts a structured startup profile and returns the top
mentor matches from MongoDB Atlas Vector Search.
"""
from fastapi import APIRouter

from app.models.schemas import MatchResponse, StartupProfile
from app.services.mentor_matching import find_matching_mentors

router = APIRouter(tags=["match"])


@router.post("/match", response_model=MatchResponse)
async def match_mentors(profile: StartupProfile) -> MatchResponse:
    """Given a startup profile (domain, stage, challenges, team_gaps),
    return the top 5 matching mentors ranked by boosted similarity score."""
    matches = find_matching_mentors(profile)
    return MatchResponse(matches=matches)
