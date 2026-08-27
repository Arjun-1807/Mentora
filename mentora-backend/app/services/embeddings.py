"""
Sentence-transformers embedding wrapper around BAAI/bge-base-en-v1.5.

BGE models are trained with an asymmetric convention:
  - QUERY side (things you are searching *with*) should be prefixed with
    the instruction: "Represent this sentence for searching relevant passages: "
  - PASSAGE/document side (things you are searching *over*, e.g. the mentor
    profiles stored in Mongo) should NOT be prefixed.

This module is the single source of truth for that convention so that
/match (query side) and seed_mentors.py (passage side) stay consistent.
"""
from functools import lru_cache
from typing import List

from sentence_transformers import SentenceTransformer

from app.config import settings

# Recommended BGE query instruction for retrieval tasks.
BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


@lru_cache
def get_embedding_model() -> SentenceTransformer:
    """Load (and cache) the sentence-transformers model.

    The model weights are downloaded from the Hugging Face Hub on first
    use and cached locally afterwards, so the very first call may take
    a while.
    """
    return SentenceTransformer(settings.EMBEDDING_MODEL_NAME)


def embed_query(text: str) -> List[float]:
    """Embed a query string (e.g. a startup profile) with the BGE query prefix."""
    model = get_embedding_model()
    vector = model.encode(
        BGE_QUERY_INSTRUCTION + text,
        normalize_embeddings=True,
    )
    return vector.tolist()


def embed_passage(text: str) -> List[float]:
    """Embed a passage/document string (e.g. a mentor profile) with NO prefix."""
    model = get_embedding_model()
    vector = model.encode(
        text,
        normalize_embeddings=True,
    )
    return vector.tolist()


def build_startup_profile_text(domain: str, stage: str, challenges: List[str], team_gaps: List[str]) -> str:
    """Build a descriptive text representation of a startup profile for embedding."""
    challenges_str = ", ".join(challenges) if challenges else "none specified"
    team_gaps_str = ", ".join(team_gaps) if team_gaps else "none specified"
    return (
        f"Domain: {domain}. Stage: {stage}. "
        f"Challenges: {challenges_str}. "
        f"Team gaps: {team_gaps_str}."
    )


def build_mentor_profile_text(domain: str, stage_focus: str, expertise: List[str]) -> str:
    """Build a descriptive text representation of a mentor profile for embedding.

    Kept structurally similar to build_startup_profile_text() so that the
    query and passage embeddings live in a comparable semantic space.
    """
    expertise_str = ", ".join(expertise) if expertise else "general mentorship"
    return (
        f"Domain: {domain}. Stage focus: {stage_focus}. "
        f"Expertise: {expertise_str}."
    )
