"""Tests for the authorization fixes on /matches/all and /feedback."""
from bson import ObjectId

from app.config import settings
from tests.conftest import MENTOR_PAYLOAD, STARTUP_PAYLOAD, auth_header, register


def _matches(fake_mongo):
    return fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MATCHES_COLLECTION]


def _mentors(fake_mongo):
    return fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MENTORS_COLLECTION]


def _seed_match(fake_mongo, *, match_id, user_id, mentor_id, status="pending"):
    _matches(fake_mongo).insert_one(
        {
            "match_id": match_id,
            "user_id": user_id,
            "mentor_id": mentor_id,
            "profile_fingerprint": "fp-" + match_id,
            "startup_profile": {"domain": "Fintech", "stage": "MVP"},
            "score": 0.5,
            "status": status,
            "timestamp": "2026-01-01T00:00:00+00:00",
        }
    )


def _seed_mentor(fake_mongo, name="Ada") -> str:
    return str(_mentors(fake_mongo).insert_one({"name": name, "domain": "Fintech", "stage_focus": "MVP"}).inserted_id)


# --- /matches/all -----------------------------------------------------------

def test_matches_all_requires_authentication(client):
    response = client.post("/matches/all")
    assert response.status_code == 401


def test_matches_all_rejects_invalid_token(client):
    response = client.post("/matches/all", headers=auth_header("garbage"))
    assert response.status_code == 401


def test_matches_all_is_scoped_to_the_calling_user(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()

    _seed_match(fake_mongo, match_id="mine", user_id=me["user_id"], mentor_id="m1")
    _seed_match(fake_mongo, match_id="theirs", user_id="507f1f77bcf86cd799439011", mentor_id="m2")

    response = client.post("/matches/all", headers=auth_header(token))
    assert response.status_code == 200
    returned = [doc["match_id"] for doc in response.json()["matches"]]
    assert returned == ["mine"]


def test_mentor_sees_matches_pointing_at_their_mentor_record(client, fake_mongo):
    token = register(client, MENTOR_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()

    _seed_match(fake_mongo, match_id="incoming", user_id="other-user", mentor_id=me["mentor_id"])
    _seed_match(fake_mongo, match_id="unrelated", user_id="other-user", mentor_id="another-mentor")

    response = client.post("/matches/all", headers=auth_header(token))
    assert [doc["match_id"] for doc in response.json()["matches"]] == ["incoming"]


# --- /feedback --------------------------------------------------------------

def test_feedback_requires_authentication(client):
    response = client.post(
        "/feedback", json={"match_id": "x", "mentor_id": "y", "attended": True, "rating": 5}
    )
    assert response.status_code == 401


def test_feedback_unknown_match_returns_404(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    mentor_id = _seed_mentor(fake_mongo)
    response = client.post(
        "/feedback",
        json={"match_id": "does-not-exist", "mentor_id": mentor_id, "attended": True, "rating": 5},
        headers=auth_header(token),
    )
    assert response.status_code == 404


def test_feedback_on_someone_elses_match_returns_403(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    mentor_id = _seed_mentor(fake_mongo)
    _seed_match(fake_mongo, match_id="not-yours", user_id="507f1f77bcf86cd799439011", mentor_id=mentor_id)

    response = client.post(
        "/feedback",
        json={"match_id": "not-yours", "mentor_id": mentor_id, "attended": True, "rating": 5},
        headers=auth_header(token),
    )
    assert response.status_code == 403
    # And the mentor's score was not touched.
    assert _mentors(fake_mongo).find_one({"_id": ObjectId(mentor_id)}).get("effectiveness_score") is None


def test_feedback_mentor_id_must_match_the_match_record(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    real_mentor = _seed_mentor(fake_mongo, "Real")
    other_mentor = _seed_mentor(fake_mongo, "Other")
    _seed_match(fake_mongo, match_id="m", user_id=me["user_id"], mentor_id=real_mentor)

    response = client.post(
        "/feedback",
        json={"match_id": "m", "mentor_id": other_mentor, "attended": True, "rating": 5},
        headers=auth_header(token),
    )
    assert response.status_code == 400


def test_feedback_success_updates_score_and_completes_match(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    mentor_id = _seed_mentor(fake_mongo)
    _seed_match(fake_mongo, match_id="m", user_id=me["user_id"], mentor_id=mentor_id, status="emailed")

    response = client.post(
        "/feedback",
        json={"match_id": "m", "mentor_id": mentor_id, "attended": True, "rating": 4},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert response.json() == {"success": True, "new_effectiveness_score": 4.0}

    mentor_doc = _mentors(fake_mongo).find_one({"_id": ObjectId(mentor_id)})
    assert mentor_doc["effectiveness_score"] == 4.0
    assert mentor_doc["feedback_count"] == 1
    assert _matches(fake_mongo).find_one({"match_id": "m"})["status"] == "completed"


def test_feedback_is_idempotent_per_match(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    mentor_id = _seed_mentor(fake_mongo)
    _seed_match(fake_mongo, match_id="m", user_id=me["user_id"], mentor_id=mentor_id)

    payload = {"match_id": "m", "mentor_id": mentor_id, "attended": True, "rating": 5}
    assert client.post("/feedback", json=payload, headers=auth_header(token)).status_code == 200

    duplicate = client.post("/feedback", json={**payload, "rating": 1}, headers=auth_header(token))
    assert duplicate.status_code == 409

    # A single rating: the score cannot be inflated by repeat submissions.
    assert _mentors(fake_mongo).find_one({"_id": ObjectId(mentor_id)})["effectiveness_score"] == 5.0


def test_feedback_summary_aggregates_per_mentor(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    mentor_id = _seed_mentor(fake_mongo, "Ada")
    _seed_match(fake_mongo, match_id="m1", user_id=me["user_id"], mentor_id=mentor_id)
    _seed_match(fake_mongo, match_id="m2", user_id=me["user_id"], mentor_id=mentor_id)

    for match_id, rating in (("m1", 5), ("m2", 3)):
        assert (
            client.post(
                "/feedback",
                json={"match_id": match_id, "mentor_id": mentor_id, "attended": True, "rating": rating},
                headers=auth_header(token),
            ).status_code
            == 200
        )

    summary = client.get("/feedback/summary", headers=auth_header(token))
    assert summary.status_code == 200
    row = summary.json()["mentors"][0]
    assert row["mentor_id"] == mentor_id
    assert row["feedback_count"] == 2
    assert row["average_rating"] == 4.0
    assert row["attended_count"] == 2
    assert row["name"] == "Ada"


def test_mentor_listing_never_exposes_embeddings(client, fake_mongo):
    token = register(client, MENTOR_PAYLOAD)
    response = client.get("/mentors", headers=auth_header(token))
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert "embedding" not in response.text


def test_mentor_listing_requires_authentication(client):
    assert client.get("/mentors").status_code == 401
