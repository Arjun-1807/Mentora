"""
Retrieval-quality metrics for the mentor matching pipeline (POST /evaluate).

All functions are pure: they take the ranked list of returned mentor ids
(best first) and the set of ground-truth relevant mentor ids, and use
binary relevance (a mentor is either relevant or not).

  precision@k = (relevant mentors in the top k) / k
  recall@k    = (relevant mentors in the top k) / |ground truth|
  MRR         = 1 / rank of the first relevant mentor (0 if none)
  NDCG@k      = DCG@k / IDCG@k, with DCG = sum(rel_i / log2(i + 1)) over
                ranks i = 1..k and IDCG the DCG of an ideal ranking that
                puts min(|ground truth|, k) relevant mentors first.

Graded relevance (used by scripts/eval_matching.py; the /evaluate API
keeps the binary metrics above unchanged):

  graded NDCG@k = DCG@k / IDCG@k with DCG = sum((2^g_i - 1) / log2(i + 1)),
                  g_i the 0-2 grade of the mentor at rank i (0 if unjudged)
                  and IDCG the DCG of the grades sorted best-first.
  score spread  = top-1 score - top-k score of one ranking: how strongly the
                  scorer separates its best candidate from the rest of the
                  shortlist (a near-zero spread means the ranking is noise).
"""
import math
from typing import Iterable, List, Mapping, Optional, Sequence, Set

DEFAULT_K = 5


def _relevant_set(ground_truth: Iterable[str]) -> Set[str]:
    return {str(item) for item in ground_truth if item}


def precision_at_k(ranked_ids: Sequence[str], ground_truth: Iterable[str], k: int = DEFAULT_K) -> float:
    if k <= 0:
        return 0.0
    relevant = _relevant_set(ground_truth)
    hits = sum(1 for mentor_id in ranked_ids[:k] if mentor_id in relevant)
    return hits / k


def recall_at_k(ranked_ids: Sequence[str], ground_truth: Iterable[str], k: int = DEFAULT_K) -> float:
    relevant = _relevant_set(ground_truth)
    if not relevant:
        return 0.0
    hits = len(relevant.intersection(ranked_ids[:k]))
    return hits / len(relevant)


def reciprocal_rank(ranked_ids: Sequence[str], ground_truth: Iterable[str]) -> float:
    relevant = _relevant_set(ground_truth)
    for rank, mentor_id in enumerate(ranked_ids, start=1):
        if mentor_id in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(ranked_ids: Sequence[str], ground_truth: Iterable[str], k: int = DEFAULT_K) -> float:
    relevant = _relevant_set(ground_truth)
    if not relevant or k <= 0:
        return 0.0
    dcg = sum(
        1.0 / math.log2(rank + 1)
        for rank, mentor_id in enumerate(ranked_ids[:k], start=1)
        if mentor_id in relevant
    )
    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return dcg / idcg if idcg else 0.0


def mean_score(scores: Iterable[Optional[float]]) -> float:
    values: List[float] = [float(s) for s in scores if s is not None]
    return sum(values) / len(values) if values else 0.0


def _gain(grade: float) -> float:
    return 2.0 ** float(grade) - 1.0


def graded_ndcg_at_k(ranked_ids: Sequence[str], grades: Mapping[str, float], k: int = DEFAULT_K) -> float:
    """NDCG@k with graded relevance (exponential gain 2^grade - 1).

    `grades` maps mentor id -> relevance grade (e.g. 0-2); ids missing from
    it count as grade 0. Returns 0.0 when nothing is relevant.
    """
    if k <= 0:
        return 0.0
    dcg = sum(
        _gain(grades.get(mentor_id, 0)) / math.log2(rank + 1)
        for rank, mentor_id in enumerate(ranked_ids[:k], start=1)
    )
    ideal = sorted((float(g) for g in grades.values() if g and g > 0), reverse=True)[:k]
    idcg = sum(_gain(g) / math.log2(rank + 1) for rank, g in enumerate(ideal, start=1))
    return dcg / idcg if idcg else 0.0


def score_spread(scores: Sequence[float], k: int = DEFAULT_K) -> float:
    """Top-1 minus top-k score of a best-first score list (0.0 if < 2 scores)."""
    top = [float(s) for s in scores[:k]]
    if len(top) < 2:
        return 0.0
    return top[0] - top[-1]
