"""
Unit tests for the weighted match-scoring formula, with the Atlas
$vectorSearch call replaced by fake candidates (no network, no Atlas).

Expected numbers are written in terms of the module's weight constants
(SIMILARITY_WEIGHT, NEED_FIT_WEIGHT, ...), so they document the formula
rather than one particular weighting.
"""
import numpy as np
import pytest

from app.models.schemas import StartupProfile
from app.services import mentor_matching as mm
from app.services.mentor_matching import TOP_K_RESULTS, find_matching_mentors

DIM = 8

PROFILE = StartupProfile(
    domain="Fintech",
    stage="MVP",
    challenges=["Customer acquisition"],
    team_gaps=["No CTO"],
    geography="San Francisco, CA",
)
# No challenges / team gaps -> need_fit is 0 for everyone, which isolates
# the other terms.
PROFILE_NO_NEEDS = PROFILE.model_copy(update={"challenges": [], "team_gaps": []})


def _unit(index: int) -> list:
    vector = [0.0] * DIM
    vector[index] = 1.0
    return vector


def _candidate(**overrides) -> dict:
    """A candidate that maxes out every term for PROFILE."""
    candidate = {
        "_id": "mentor-1",
        "name": "Ava Chen",
        "domain": "Fintech",
        "stage_focus": "MVP",
        "expertise": ["Fundraising"],
        # Skill embeddings identical to the need embeddings below -> cos 1.
        "skills": ["Growth marketing", "Technical leadership"],
        "skill_embeddings": [_unit(0), _unit(1)],
        "geography": "San Francisco, CA",
        "effectiveness_score": 5.0,
        "score": 1.0,
    }
    candidate.update(overrides)
    return candidate


def _zero(**overrides) -> dict:
    """A candidate that scores 0 on every term (for PROFILE_NO_NEEDS)."""
    fields = dict(
        score=0.0, domain="X", stage_focus="idea", geography="Berlin", effectiveness_score=None,
        skills=[], skill_embeddings=[], expertise=[],
    )
    fields.update(overrides)
    return _candidate(**fields)


@pytest.fixture(autouse=True)
def fake_need_embeddings(monkeypatch):
    """Need i of the profile embeds to unit vector i (orthogonal needs)."""
    monkeypatch.setattr(mm, "embed_queries", lambda texts: [_unit(i % DIM) for i, _ in enumerate(texts)])
    monkeypatch.setattr(mm, "embed_passages", lambda texts: [_unit(DIM - 1) for _ in texts])


@pytest.fixture
def fake_vector_search(monkeypatch):
    def install(candidates):
        monkeypatch.setattr(mm, "_run_vector_search", lambda _embedding: candidates)

    return install


def _score(profile, candidate) -> float:
    [match] = find_matching_mentors(profile)
    return match.match_score


def test_perfect_match_scores_one(fake_vector_search):
    fake_vector_search([_candidate()])
    assert find_matching_mentors(PROFILE)[0].match_score == 1.0


def test_each_weight_contributes_its_documented_share(fake_vector_search):
    cases = {
        "similarity_only": (_zero(score=1.0), mm.SIMILARITY_WEIGHT),
        "stage_only": (_zero(stage_focus="MVP"), mm.STAGE_MATCH_WEIGHT),
        "domain_only": (_zero(domain="Fintech"), mm.DOMAIN_MATCH_WEIGHT),
        "geography_only": (_zero(geography="San Francisco, CA"), mm.GEOGRAPHY_MATCH_WEIGHT),
        "effectiveness_only": (_zero(effectiveness_score=5.0), mm.EFFECTIVENESS_WEIGHT),
    }
    for label, (candidate, expected) in cases.items():
        fake_vector_search([candidate])
        assert find_matching_mentors(PROFILE_NO_NEEDS)[0].match_score == pytest.approx(expected, abs=1e-4), label


def test_need_fit_contributes_its_share(fake_vector_search):
    fake_vector_search([_zero(skills=["Growth marketing", "Technical leadership"],
                              skill_embeddings=[_unit(0), _unit(1)])])
    assert find_matching_mentors(PROFILE)[0].match_score == pytest.approx(mm.NEED_FIT_WEIGHT, abs=1e-4)


def test_weights_sum_to_one():
    total = (
        mm.SIMILARITY_WEIGHT
        + mm.NEED_FIT_WEIGHT
        + mm.DOMAIN_MATCH_WEIGHT
        + mm.STAGE_MATCH_WEIGHT
        + mm.GEOGRAPHY_MATCH_WEIGHT
        + mm.EFFECTIVENESS_WEIGHT
    )
    assert total == pytest.approx(1.0)
    assert mm.COSINE_WEIGHT == mm.SIMILARITY_WEIGHT


def test_documented_final_weights():
    assert (
        mm.SIMILARITY_WEIGHT, mm.NEED_FIT_WEIGHT, mm.DOMAIN_MATCH_WEIGHT,
        mm.STAGE_MATCH_WEIGHT, mm.GEOGRAPHY_MATCH_WEIGHT, mm.EFFECTIVENESS_WEIGHT,
    ) == (0.35, 0.22, 0.15, 0.12, 0.05, 0.11)


def test_matching_is_case_insensitive(fake_vector_search):
    candidate = _zero(domain="  fintech ", stage_focus="mvp", geography="SAN FRANCISCO, CA")
    fake_vector_search([candidate])
    expected = mm.DOMAIN_MATCH_WEIGHT + mm.STAGE_MATCH_WEIGHT + mm.GEOGRAPHY_MATCH_WEIGHT
    assert find_matching_mentors(PROFILE_NO_NEEDS)[0].match_score == pytest.approx(expected, abs=1e-4)


def test_missing_geography_on_either_side_scores_zero(fake_vector_search):
    fake_vector_search([_zero(geography=None)])
    assert find_matching_mentors(PROFILE_NO_NEEDS)[0].match_score == 0.0

    fake_vector_search([_zero(geography="San Francisco, CA")])
    assert find_matching_mentors(PROFILE_NO_NEEDS.model_copy(update={"geography": None}))[0].match_score == 0.0


def test_raw_vector_score_is_clamped_before_calibration(fake_vector_search):
    fake_vector_search([_zero(score=17.0), _zero(_id="m2", score=-3.0)])
    scores = sorted(match.match_score for match in find_matching_mentors(PROFILE_NO_NEEDS))
    assert scores == [0.0, pytest.approx(mm.SIMILARITY_WEIGHT)]


def test_results_are_sorted_and_capped_at_top_k(fake_vector_search):
    candidates = [
        # Raw Atlas scores inside the calibrated band.
        _candidate(_id=f"m{i}", score=0.77 + i / 100.0, effectiveness_score=None, geography="Berlin")
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


# --- stage coverage via preferred_stages / "all" -----------------------------

@pytest.mark.parametrize(
    "overrides, matches",
    [
        ({"stage_focus": "growth", "preferred_stages": ["idea", "MVP"]}, True),
        ({"stage_focus": "growth", "preferred_stages": ["mvp"]}, True),
        ({"stage_focus": "all"}, True),
        ({"stage_focus": "growth", "preferred_stages": ["all"]}, True),
        ({"stage_focus": "growth", "preferred_stages": ["growth"]}, False),
        ({"stage_focus": "growth"}, False),
        ({"stage_focus": None, "preferred_stages": None}, False),
    ],
)
def test_preferred_stages_and_all_count_as_stage_match(fake_vector_search, overrides, matches):
    fake_vector_search([_zero(**overrides)])
    expected = mm.STAGE_MATCH_WEIGHT if matches else 0.0
    assert find_matching_mentors(PROFILE_NO_NEEDS)[0].match_score == pytest.approx(expected, abs=1e-4)


def test_match_exposes_similarity_email_and_geography(fake_vector_search):
    fake_vector_search([_candidate(score=0.83, email="ava@example.com")])
    [match] = find_matching_mentors(PROFILE)
    assert match.similarity == pytest.approx(0.83)
    assert match.email == "ava@example.com"
    assert match.geography == "San Francisco, CA"


@pytest.mark.parametrize(
    "startup_domain, mentor_domain, matches",
    [
        ("Climate Tech", "Clean Energy", True),
        ("CleanTech", "clean energy", True),
        ("E-commerce", "Ecommerce", True),
        ("FinTech", "Fintech", True),
        ("Climate Tech", "HealthTech", False),
        ("Climate Tech", "", False),
    ],
)
def test_domain_synonyms_count_as_domain_match(fake_vector_search, startup_domain, mentor_domain, matches):
    fake_vector_search([_zero(domain=mentor_domain)])
    profile = PROFILE_NO_NEEDS.model_copy(update={"domain": startup_domain})
    expected = mm.DOMAIN_MATCH_WEIGHT if matches else 0.0
    assert find_matching_mentors(profile)[0].match_score == pytest.approx(expected, abs=1e-4)


# --- similarity calibration ---------------------------------------------------

@pytest.mark.parametrize(
    "raw_score, expected",
    [
        (1.0, 1.0),                         # cos 1.0 -> above the ceiling
        ((1 + mm.COS_CEIL) / 2, 1.0),       # cos == ceiling
        ((1 + mm.COS_FLOOR) / 2, 0.0),      # cos == floor
        (0.5, 0.0),                         # cos 0 -> below the floor
        (0.0, 0.0),
    ],
)
def test_calibrate_similarity_endpoints(raw_score, expected):
    assert mm.calibrate_similarity(raw_score) == pytest.approx(expected)


def test_calibrate_similarity_undoes_atlas_mapping_and_is_linear_in_band():
    floor, ceil = mm.COS_FLOOR, mm.COS_CEIL
    mid_cos = (floor + ceil) / 2
    assert mm.calibrate_similarity((1 + mid_cos) / 2) == pytest.approx(0.5)
    # A raw 0.80 vs 0.85 gap (typical Atlas scores) becomes a large spread.
    low, high = mm.calibrate_similarity(0.80), mm.calibrate_similarity(0.85)
    assert high - low == pytest.approx(0.1 / (ceil - floor))


def test_similarity_field_stays_the_raw_vector_search_score(fake_vector_search):
    fake_vector_search([_candidate(score=0.8)])
    [match] = find_matching_mentors(PROFILE)
    assert match.similarity == pytest.approx(0.8)


# --- need fit -------------------------------------------------------------------

def test_need_fit_is_mean_over_needs_of_best_skill_similarity():
    needs = ["Raise a seed round", "Hire a CTO"]
    need_vectors = np.array([_unit(0), _unit(1)])
    skills = ["Seed fundraising", "Branding"]
    # Need 0 matches skill 0 exactly (cos 1 -> 1.0); need 1 matches nothing
    # (cos 0 -> below the floor -> 0.0).
    skill_matrix = np.array([_unit(0), _unit(2)])
    need_fit, reasons = mm.compute_need_fit(needs, need_vectors, skills, skill_matrix)
    assert need_fit == pytest.approx(0.5)
    assert reasons == ["Raise a seed round → Seed fundraising"]


def test_need_fit_uses_calibrated_pair_similarity():
    cos = (mm.SKILL_COS_FLOOR + mm.SKILL_COS_CEIL) / 2
    need_vectors = np.array([[1.0, 0.0]])
    skill_matrix = np.array([[cos, np.sqrt(1 - cos ** 2)]])
    need_fit, _ = mm.compute_need_fit(["n"], need_vectors, ["s"], skill_matrix)
    assert need_fit == pytest.approx(0.5)


def test_need_fit_reasons_are_best_first_capped_and_one_per_skill():
    needs = [f"need {i}" for i in range(5)]
    need_vectors = np.array([_unit(i) for i in range(5)])
    skills = ["a", "b", "c", "d"]
    # need 0..3 -> skill 0..3 with decreasing strength; need 4 -> skill 0 again.
    skill_matrix = np.array([_unit(0) for _ in range(4)], dtype=float) * 0
    skill_matrix[0] = np.array(_unit(0)) + np.array(_unit(4))
    skill_matrix[1] = _unit(1)
    skill_matrix[2] = np.array(_unit(2)) * 0.9
    skill_matrix[3] = np.array(_unit(3)) * 0.8
    _, reasons = mm.compute_need_fit(needs, need_vectors, skills, skill_matrix)
    assert len(reasons) == mm.MAX_REASONS
    assert reasons[0] in ("need 0 → a", "need 4 → a", "need 1 → b")
    assert len({reason.split(" → ")[1] for reason in reasons}) == len(reasons)


def test_need_fit_edge_cases():
    vectors = np.array([_unit(0)])
    assert mm.compute_need_fit([], None, ["s"], np.array([_unit(0)])) == (0.0, [])
    assert mm.compute_need_fit(["n"], vectors, [], None) == (mm.NEED_FIT_UNKNOWN, [])


def test_mentor_without_skills_gets_the_neutral_need_fit(fake_vector_search):
    fake_vector_search([_zero()])
    assert find_matching_mentors(PROFILE)[0].match_score == pytest.approx(
        mm.NEED_FIT_WEIGHT * mm.NEED_FIT_UNKNOWN, abs=1e-4
    )


def test_legacy_expertise_is_used_as_skills_but_sector_names_are_not():
    assert mm.mentor_skills({"expertise": ["Fundraising", "Hiring"]}) == ["Fundraising", "Hiring"]
    assert mm.mentor_skills(
        {"expertise": ["FinTech", "SaaS", "Fundraising"], "sector_expertise": ["FinTech", "SaaS"]}
    ) == ["Fundraising"]
    assert mm.mentor_skills({"skills": ["Seed fundraising"], "expertise": ["Hiring"]}) == ["Seed fundraising"]


def test_missing_skill_embeddings_are_computed_on_the_fly(fake_vector_search, monkeypatch):
    calls = []
    monkeypatch.setattr(mm, "embed_passages", lambda texts: calls.append(list(texts)) or [_unit(0) for _ in texts])
    fake_vector_search([_zero(skills=["Growth marketing"], skill_embeddings=None)])
    [match] = find_matching_mentors(PROFILE)
    assert calls == [["Growth marketing"]]
    # Need 0 matches perfectly, need 1 not at all -> need_fit 0.5.
    assert match.match_score == pytest.approx(mm.NEED_FIT_WEIGHT * 0.5, abs=1e-4)
    assert match.reasons == ["Customer acquisition → Growth marketing"]


def test_reasons_are_returned_on_the_match(fake_vector_search):
    fake_vector_search([_candidate()])
    [match] = find_matching_mentors(PROFILE)
    assert match.reasons == ["Customer acquisition → Growth marketing", "No CTO → Technical leadership"]
