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
"""
import math
from typing import Iterable, List, Optional, Sequence, Set

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
