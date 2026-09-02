"""
Unit tests for the weighted match-scoring formula, with the Atlas
$vectorSearch call replaced by fake candidates (no network, no Atlas).
"""
import pytest

from app.models.schemas import StartupProfile
from app.services import mentor_matching
from app.services.mentor_matching import TOP_K_RESULTS, find_matching_mentors

PROFILE = StartupProfile(
    domain="Fintech",
    stage="MVP",
    challenges=["Customer acquisition"],
    team_gaps=["No CTO"],
    geography="San Francisco, CA",
)


def _candidate(**overrides) -> dict:
    candidate = {
        "_id": "mentor-1",
        "name": "Ava Chen",
        "domain": "Fintech",
        "stage_focus": "MVP",
        "expertise": ["Fundraising"],
        "geography": "San Francisco, CA",
        "effectiveness_score": 5.0,
        "score": 1.0,
    }
    candidate.update(overrides)
    return candidate


@pytest.fixture
def fake_vector_search(monkeypatch):
    def install(candidates):
        monkeypatch.setattr(mentor_matching, "_run_vector_search", lambda _embedding: candidates)

    return install


def test_perfect_match_scores_one(fake_vector_search):
    fake_vector_search([_candidate()])
    result = find_matching_mentors(PROFILE)
    assert result[0].match_score == 1.0


def test_each_weight_contributes_its_documented_share(fake_vector_search):
    # cosine 0.5 + stage 0.2 + domain 0.15 + geography 0.05 + effectiveness 0.10
    cases = {
        "cosine_only": (_candidate(domain="X", stage_focus="idea", geography="Berlin", effectiveness_score=None), 0.5),
        "stage_only": (
            _candidate(score=0.0, domain="X", geography="Berlin", effectiveness_score=None),
            0.2,
        ),
        "domain_only": (
            _candidate(score=0.0, stage_focus="idea", geography="Berlin", effectiveness_score=None),
            0.15,
        ),
        "geography_only": (
            _candidate(score=0.0, domain="X", stage_focus="idea", effectiveness_score=None),
            0.05,
        ),
        "effectiveness_only": (
            _candidate(score=0.0, domain="X", stage_focus="idea", geography="Berlin"),
            0.10,
        ),
    }
    for label, (candidate, expected) in cases.items():
        fake_vector_search([candidate])
        assert find_matching_mentors(PROFILE)[0].match_score == pytest.approx(expected), label


def test_effectiveness_is_normalised_by_five(fake_vector_search):
    candidate = _candidate(score=0.0, domain="X", stage_focus="idea", geography="Berlin", effectiveness_score=2.5)
    fake_vector_search([candidate])
    assert find_matching_mentors(PROFILE)[0].match_score == pytest.approx(0.05)


def test_matching_is_case_insensitive(fake_vector_search):
    candidate = _candidate(score=0.0, domain="  fintech ", stage_focus="mvp", geography="SAN FRANCISCO, CA",
                           effectiveness_score=None)
    fake_vector_search([candidate])
    assert find_matching_mentors(PROFILE)[0].match_score == pytest.approx(0.4)


def test_missing_geography_on_either_side_scores_zero(fake_vector_search):
    candidate = _candidate(score=0.0, domain="X", stage_focus="idea", geography=None, effectiveness_score=None)
    fake_vector_search([candidate])
    assert find_matching_mentors(PROFILE)[0].match_score == 0.0

    profile_without_geography = PROFILE.model_copy(update={"geography": None})
    fake_vector_search([_candidate(score=0.0, domain="X", stage_focus="idea", effectiveness_score=None)])
    assert find_matching_mentors(profile_without_geography)[0].match_score == 0.0


def test_cosine_score_is_clamped(fake_vector_search):
    fake_vector_search([_candidate(score=17.0), _candidate(_id="m2", score=-3.0)])
    scores = [match.match_score for match in find_matching_mentors(PROFILE)]
    assert max(scores) == 1.0
    assert min(scores) == pytest.approx(0.5)


def test_results_are_sorted_and_capped_at_top_k(fake_vector_search):
    candidates = [
        _candidate(_id=f"m{i}", score=i / 10.0, effectiveness_score=None, geography="Berlin")
        for i in range(10)
    ]
    fake_vector_search(candidates)
    results = find_matching_mentors(PROFILE)
    assert len(results) == TOP_K_RESULTS
    assert [match.mentor_id for match in results] == ["m9", "m8", "m7", "m6", "m5"]
    assert results == sorted(results, key=lambda m: m.match_score, reverse=True)


def test_no_candidates_returns_empty_list(fake_vector_search):
    fake_vector_search([])
    assert find_matching_mentors(PROFILE) == []


def test_weights_sum_to_one():
    total = (
        mentor_matching.COSINE_WEIGHT
        + mentor_matching.STAGE_MATCH_WEIGHT
        + mentor_matching.DOMAIN_MATCH_WEIGHT
        + mentor_matching.GEOGRAPHY_MATCH_WEIGHT
        + mentor_matching.EFFECTIVENESS_WEIGHT
    )
    assert total == pytest.approx(1.0)
