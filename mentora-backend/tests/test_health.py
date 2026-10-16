"""Tests for the startup health score (Section 3)."""
import pytest
from bson import ObjectId

from app.services.health import compute_health_score, compute_trend
from tests.conftest import (
    COORDINATOR_PAYLOAD,
    MENTOR_PAYLOAD,
    STARTUP_PAYLOAD,
    auth_header,
    db,
    insert_match,
    me,
    register,
    register_coordinator,
)

OTHER_STARTUP = {**STARTUP_PAYLOAD, "email": "other@example.com"}
OTHER_MENTOR = {**MENTOR_PAYLOAD, "email": "mentor2@example.com"}


def _note(momentum, engagement, resolved):
    return {"momentum_score": momentum, "mentor_engagement": engagement, "blockers_resolved": resolved}


# --- formula -----------------------------------------------------------------------

def test_normalised_formula_spans_the_full_range():
    assert compute_health_score([_note(5, 5, True)]) == 100.0
    assert compute_health_score([_note(1, 1, False)]) == 16.0
    # (3/5*0.5 + 4/5*0.3 + 0.5*0.2) * 100 = 30 + 24 + 10
    assert compute_health_score([_note(3, 4, True), _note(3, 4, False)]) == 64.0
    assert compute_health_score([]) is None


def test_trend_thresholds():
    assert compute_trend(70, None) == "stable"
    assert compute_trend(75, 70) == "up"
    assert compute_trend(74.9, 70) == "stable"
    assert compute_trend(65, 70) == "down"
    assert compute_trend(66, 70) == "stable"


# --- fixtures ------------------------------------------------------------------------

@pytest.fixture
def setup(client, fake_mongo):
    startup_token = register(client, STARTUP_PAYLOAD)
    startup = me(client, startup_token)
    mentor_token = register(client, MENTOR_PAYLOAD)
    mentor = me(client, mentor_token)
    match = insert_match(
        fake_mongo,
        user_id=startup["user_id"],
        mentor_id=mentor["mentor_id"],
        status="meeting_scheduled",
        startup_profile={"domain": "Clean Energy", "stage": "growth", "challenges": [], "team_gaps": []},
        timestamp="2026-10-05T10:00:00+00:00",
    )
    return {
        "startup_token": startup_token,
        "startup": startup,
        "mentor_token": mentor_token,
        "mentor": mentor,
        "match": match,
    }


def _log(client, token, match_id, momentum=4, engagement=4, resolved=True, notes=None):
    body = {
        "match_id": match_id,
        "momentum_score": momentum,
        "blockers_resolved": resolved,
        "mentor_engagement": engagement,
    }
    if notes is not None:
        body["notes"] = notes
    return client.post("/health/log", json=body, headers=auth_header(token))


# --- POST /health/log --------------------------------------------------------------------

def test_startup_logs_outcome(client, fake_mongo, setup):
    response = _log(client, setup["startup_token"], setup["match"]["match_id"], 5, 5, True, notes="Great call")
    assert response.status_code == 200, response.text
    assert response.json() == {"health_score": 100.0, "trend": "stable"}

    note = db(fake_mongo)["meeting_notes"].find_one({})
    assert note["startup_id"] == setup["startup"]["user_id"]
    assert note["mentor_id"] == setup["mentor"]["mentor_id"]
    assert note["match_id"] == setup["match"]["match_id"]
    assert note["submitted_by"] == "startup"
    assert note["notes"] == "Great call"

    user = db(fake_mongo)["users"].find_one({"_id": ObjectId(setup["startup"]["user_id"])})
    assert user["health_score"] == 100.0
    assert len(user["health_history"]) == 1
    match = db(fake_mongo)["matches"].find_one({"match_id": setup["match"]["match_id"]})
    assert match["health_logged_by"] == ["startup"]


def test_mentor_logs_outcome_and_trend_moves(client, fake_mongo, setup):
    first = _log(client, setup["startup_token"], setup["match"]["match_id"], 5, 5, True)
    assert first.json()["health_score"] == 100.0

    second = _log(client, setup["mentor_token"], setup["match"]["match_id"], 1, 1, False)
    assert second.status_code == 200, second.text
    # Average of both notes: (3/5*0.5 + 3/5*0.3 + 0.5*0.2) * 100 = 58
    assert second.json() == {"health_score": 58.0, "trend": "down"}

    third = _log(client, setup["startup_token"], setup["match"]["match_id"], 5, 5, True)
    assert third.json()["trend"] == "up"

    match = db(fake_mongo)["matches"].find_one({"match_id": setup["match"]["match_id"]})
    assert sorted(match["health_logged_by"]) == ["mentor", "startup"]
    assert db(fake_mongo)["meeting_notes"].find_one({"submitted_by": "mentor"}) is not None


def test_score_uses_only_the_last_five_notes(client, setup):
    match_id = setup["match"]["match_id"]
    _log(client, setup["startup_token"], match_id, 1, 1, False)
    for _ in range(5):
        response = _log(client, setup["startup_token"], match_id, 5, 5, True)
    assert response.json()["health_score"] == 100.0


def test_log_accepts_mongo_id_too(client, setup):
    response = _log(client, setup["startup_token"], str(setup["match"]["_id"]))
    assert response.status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [{"momentum": 0}, {"momentum": 6}, {"engagement": 0}, {"engagement": 9}, {"resolved": "yes"}],
)
def test_out_of_range_values_are_422(client, setup, overrides):
    assert _log(client, setup["startup_token"], setup["match"]["match_id"], **overrides).status_code == 422


def test_log_requires_party_to_the_match(client, fake_mongo, setup):
    other_startup = register(client, OTHER_STARTUP)
    other_mentor = register(client, OTHER_MENTOR)
    coordinator = register_coordinator(client)
    for token in (other_startup, other_mentor, coordinator):
        assert _log(client, token, setup["match"]["match_id"]).status_code == 403
    assert db(fake_mongo)["meeting_notes"].count_documents({}) == 0


def test_log_unknown_match_is_404(client, setup):
    assert _log(client, setup["startup_token"], "nope").status_code == 404


def test_log_requires_auth(client):
    response = client.post(
        "/health/log",
        json={"match_id": "x", "momentum_score": 3, "blockers_resolved": True, "mentor_engagement": 3},
    )
    assert response.status_code == 401


# --- GET /health/{startup_id} --------------------------------------------------------------

def test_get_own_health_via_me(client, setup):
    empty = client.get("/health/me", headers=auth_header(setup["startup_token"]))
    assert empty.status_code == 200
    assert empty.json() == {"health_score": None, "trend": "stable", "health_history": [], "last_updated": None}

    _log(client, setup["startup_token"], setup["match"]["match_id"], 5, 5, True)
    _log(client, setup["startup_token"], setup["match"]["match_id"], 1, 1, False)
    body = client.get("/health/me", headers=auth_header(setup["startup_token"])).json()
    assert body["health_score"] == 58.0
    assert body["trend"] == "down"
    assert [h["score"] for h in body["health_history"]] == [100.0, 58.0]
    assert all(h["timestamp"] for h in body["health_history"])
    assert body["last_updated"]


def test_health_history_is_capped_at_ten(client, setup):
    for _ in range(12):
        _log(client, setup["startup_token"], setup["match"]["match_id"])
    body = client.get("/health/me", headers=auth_header(setup["startup_token"])).json()
    assert len(body["health_history"]) == 10


def test_health_access_rules(client, setup):
    startup_id = setup["startup"]["user_id"]
    coordinator = register_coordinator(client)
    other_startup = register(client, OTHER_STARTUP)
    other_mentor = register(client, OTHER_MENTOR)

    assert client.get(f"/health/{startup_id}", headers=auth_header(setup["startup_token"])).status_code == 200
    assert client.get(f"/health/{startup_id}", headers=auth_header(coordinator)).status_code == 200
    assert client.get(f"/health/{startup_id}", headers=auth_header(setup["mentor_token"])).status_code == 200
    assert client.get(f"/health/{startup_id}", headers=auth_header(other_startup)).status_code == 403
    assert client.get(f"/health/{startup_id}", headers=auth_header(other_mentor)).status_code == 403
    assert client.get(f"/health/{ObjectId()}", headers=auth_header(coordinator)).status_code == 404


# --- GET /health/cohort ------------------------------------------------------------------------

def test_cohort_is_coordinator_only(client, setup):
    # Also proves /health/cohort is not captured by /health/{startup_id}.
    assert client.get("/health/cohort", headers=auth_header(setup["startup_token"])).status_code == 403
    assert client.get("/health/cohort", headers=auth_header(setup["mentor_token"])).status_code == 403
    assert client.get("/health/cohort").status_code == 401


def test_cohort_lists_startups_with_activity(client, fake_mongo, setup):
    insert_match(
        fake_mongo,
        user_id=setup["startup"]["user_id"],
        mentor_id=setup["mentor"]["mentor_id"],
        status="pending",
        startup_profile={"domain": "Old Domain", "stage": "idea"},
        timestamp="2026-09-01T10:00:00+00:00",
    )
    _log(client, setup["startup_token"], setup["match"]["match_id"], 3, 4, True)
    register(client, OTHER_STARTUP)
    coordinator = register_coordinator(client)

    response = client.get("/health/cohort", headers=auth_header(coordinator))
    assert response.status_code == 200, response.text
    rows = response.json()["startups"]
    # Startups only (no mentor / coordinator rows), scored ones first.
    assert [r["email"] for r in rows] == [STARTUP_PAYLOAD["email"], OTHER_STARTUP["email"]]

    first = rows[0]
    assert first["user_id"] == setup["startup"]["user_id"]
    assert first["domain"] == "Clean Energy"   # from the latest match
    assert first["stage"] == "growth"
    assert first["health_score"] == 74.0       # (3/5*.5 + 4/5*.3 + 1*.2) * 100
    assert first["trend"] == "stable"
    assert first["match_count"] == 2
    assert first["meeting_count"] == 1
    assert first["last_activity"]
    assert [h["score"] for h in first["health_history"]] == [74.0]

    second = rows[1]
    assert second == {
        "user_id": second["user_id"],
        "email": OTHER_STARTUP["email"],
        "domain": None,
        "stage": None,
        "health_score": None,
        "trend": "stable",
        "match_count": 0,
        "meeting_count": 0,
        "last_activity": None,
        "health_history": [],
    }
