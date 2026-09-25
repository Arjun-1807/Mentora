"""Tests for the retrieval metrics and POST /evaluate."""
import math

import pytest

from app.models.schemas import MentorMatch
from app.services.evaluation import (
    mean_score,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    reciprocal_rank,
)
from tests.conftest import STARTUP_PAYLOAD, auth_header, register, seed_mentor

RANKED = ["a", "b", "c", "d", "e"]


# --- pure metric math ----------------------------------------------------------

def test_precision_divides_hits_by_k():
    assert precision_at_k(RANKED, ["b", "d", "z"]) == pytest.approx(2 / 5)
    assert precision_at_k(RANKED, ["z"]) == 0.0
    # Fewer than k results still divides by k.
    assert precision_at_k(["a"], ["a"]) == pytest.approx(1 / 5)


def test_recall_divides_hits_by_ground_truth_size():
    assert recall_at_k(RANKED, ["b", "d", "z"]) == pytest.approx(2 / 3)
    assert recall_at_k(RANKED, ["a", "a"]) == pytest.approx(1.0)  # duplicates collapse
    assert recall_at_k(RANKED, []) == 0.0


def test_reciprocal_rank_uses_first_relevant():
    assert reciprocal_rank(RANKED, ["c", "e"]) == pytest.approx(1 / 3)
    assert reciprocal_rank(RANKED, ["a"]) == 1.0
    assert reciprocal_rank(RANKED, ["z"]) == 0.0


def test_ndcg_hand_computed():
    # Relevant at ranks 2 and 4, |GT| = 3:
    # DCG  = 1/log2(3) + 1/log2(5)
    # IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4)
    dcg = 1 / math.log2(3) + 1 / math.log2(5)
    idcg = 1 + 1 / math.log2(3) + 1 / math.log2(4)
    assert ndcg_at_k(RANKED, ["b", "d", "z"]) == pytest.approx(dcg / idcg)
    # = (0.6309 + 0.4307) / (1 + 0.6309 + 0.5) = 1.0616 / 2.1309
    assert ndcg_at_k(RANKED, ["b", "d", "z"]) == pytest.approx(0.4982, abs=1e-4)


def test_ndcg_perfect_and_empty():
    assert ndcg_at_k(RANKED, ["a", "b"]) == pytest.approx(1.0)
    assert ndcg_at_k(RANKED, RANKED + ["f", "g"]) == pytest.approx(1.0)  # IDCG capped at k
    assert ndcg_at_k(RANKED, ["z"]) == 0.0
    assert ndcg_at_k([], ["a"]) == 0.0


def test_mean_score_ignores_missing():
    assert mean_score([0.8, 0.6, None]) == pytest.approx(0.7)
    assert mean_score([]) == 0.0


# --- POST /evaluate -------------------------------------------------------------

PROFILE = {"domain": "Fintech", "stage": "MVP", "challenges": ["Runway"], "team_gaps": []}


def _fake_top5():
    return [
        MentorMatch(
            mentor_id=mentor_id,
            name=mentor_id,
            domain="Fintech",
            stage_focus="MVP",
            expertise=[],
            match_score=0.9 - i / 10,
            similarity=similarity,
        )
        for i, (mentor_id, similarity) in enumerate(zip(RANKED, [0.9, 0.8, 0.7, 0.6, 0.5]))
    ]


def test_evaluate_computes_all_metrics(client, fake_mongo, monkeypatch):
    from app.routers import evaluate as evaluate_router
    from app.config import settings

    monkeypatch.setattr(evaluate_router, "find_matching_mentors", lambda profile: _fake_top5())
    seed_mentor(fake_mongo)
    token = register(client, STARTUP_PAYLOAD)

    response = client.post(
        "/evaluate",
        json={"startup_profile": PROFILE, "ground_truth_mentor_ids": ["b", "d", "z"]},
        headers=auth_header(token),
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "precision_at_5": 0.4,
        "recall_at_5": 0.6667,
        "mrr": 0.5,
        "ndcg_at_5": 0.4982,
        "avg_match_score": 0.7,
        "top_5_mentor_ids": RANKED,
    }
    # Evaluation never records match history.
    assert fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MATCHES_COLLECTION].count_documents({}) == 0


def test_evaluate_requires_authentication(client):
    response = client.post("/evaluate", json={"startup_profile": PROFILE, "ground_truth_mentor_ids": ["a"]})
    assert response.status_code == 401


@pytest.mark.parametrize("ids", [[], ["", "  "]])
def test_evaluate_requires_ground_truth(client, ids):
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/evaluate",
        json={"startup_profile": PROFILE, "ground_truth_mentor_ids": ids},
        headers=auth_header(token),
    )
    assert response.status_code == 422
    assert "ground_truth_mentor_ids" in response.json()["error"]


@pytest.mark.parametrize("path, body", [
    ("/evaluate", {"startup_profile": PROFILE, "ground_truth_mentor_ids": ["a"]}),
    ("/match", PROFILE),
])
def test_no_mentors_is_404(client, path, body):
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(path, json=body, headers=auth_header(token))
    assert response.status_code == 404
    assert response.json()["error"] == "No mentor profiles found. Please seed the database."
