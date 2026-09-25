"""
POST /evaluate - runs the matching pipeline for a startup profile and
scores the ranking against a caller-supplied set of ground-truth mentors
(precision@5, recall@5, MRR, NDCG@5, mean cosine similarity).

Evaluation runs never create match records: they must not pollute a
user's match history or dashboard stats.
"""
import logging

from fastapi import APIRouter, Depends

from app.models.schemas import EvaluateRequest, EvaluateResponse
from app.services.auth_dependency import get_current_user
from app.services.evaluation import (
    mean_score,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    reciprocal_rank,
)
from app.services.mentor_matching import TOP_K_RESULTS, ensure_mentors_exist, find_matching_mentors

logger = logging.getLogger(__name__)

router = APIRouter(tags=["evaluate"])


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_matching(request: EvaluateRequest, user=Depends(get_current_user)) -> EvaluateResponse:
    """Score the top-5 mentors returned for `startup_profile` against
    `ground_truth_mentor_ids`. Returns 404 if no mentors exist."""
    ensure_mentors_exist()

    top = find_matching_mentors(request.startup_profile)[:TOP_K_RESULTS]
    ranked_ids = [match.mentor_id for match in top]
    ground_truth = request.ground_truth_mentor_ids

    return EvaluateResponse(
        precision_at_5=round(precision_at_k(ranked_ids, ground_truth, TOP_K_RESULTS), 4),
        recall_at_5=round(recall_at_k(ranked_ids, ground_truth, TOP_K_RESULTS), 4),
        mrr=round(reciprocal_rank(ranked_ids, ground_truth), 4),
        ndcg_at_5=round(ndcg_at_k(ranked_ids, ground_truth, TOP_K_RESULTS), 4),
        avg_match_score=round(mean_score(match.similarity for match in top), 4),
        top_5_mentor_ids=ranked_ids,
    )
