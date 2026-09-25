"""Tests for strict /feedback validation and POST /feedback-status."""
import pytest

from app.config import settings
from tests.conftest import STARTUP_PAYLOAD, auth_header, register


def _matches(fake_mongo):
    return fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MATCHES_COLLECTION]


def _owned_match(client, fake_mongo, status="pending"):
    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    _matches(fake_mongo).insert_one(
        {"match_id": "m1", "user_id": me["user_id"], "mentor_id": "507f1f77bcf86cd799439011", "status": status}
    )
    return token


# --- /feedback strict validation ---------------------------------------------

@pytest.mark.parametrize(
    "overrides",
    [
        {"rating": 0},
        {"rating": 6},
        {"rating": "3"},
        {"rating": 3.5},
        {"rating": True},
        {"attended": "yes"},
        {"attended": "true"},
        {"attended": 1},
        {"attended": None},
    ],
)
def test_feedback_rejects_invalid_rating_or_attended(client, overrides):
    token = register(client, STARTUP_PAYLOAD)
    payload = {"match_id": "m1", "mentor_id": "507f1f77bcf86cd799439011", "attended": True, "rating": 4}
    payload.update(overrides)
    response = client.post("/feedback", json=payload, headers=auth_header(token))
    assert response.status_code == 422
    field = next(iter(overrides))
    assert field in response.json()["error"]


# --- /feedback-status --------------------------------------------------------

def test_feedback_status_requires_authentication(client):
    assert client.post("/feedback-status", json={"match_id": "m1", "status": "email_sent"}).status_code == 401


def test_feedback_status_marks_email_sent(client, fake_mongo):
    token = _owned_match(client, fake_mongo, status="emailed")
    response = client.post(
        "/feedback-status", json={"match_id": "m1", "status": "email_sent"}, headers=auth_header(token)
    )
    assert response.status_code == 200
    assert response.json() == {"success": True, "match_id": "m1", "status": "email_sent"}
    doc = _matches(fake_mongo).find_one({"match_id": "m1"})
    assert doc["status"] == "email_sent"
    assert doc["email_sent_at"]


def test_feedback_status_can_skip_from_pending_to_email_sent(client, fake_mongo):
    token = _owned_match(client, fake_mongo, status="pending")
    response = client.post(
        "/feedback-status", json={"match_id": "m1", "status": "email_sent"}, headers=auth_header(token)
    )
    assert response.json()["status"] == "email_sent"


def test_feedback_status_never_regresses(client, fake_mongo):
    token = _owned_match(client, fake_mongo, status="completed")
    response = client.post(
        "/feedback-status", json={"match_id": "m1", "status": "emailed"}, headers=auth_header(token)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert _matches(fake_mongo).find_one({"match_id": "m1"})["status"] == "completed"


def test_feedback_status_is_idempotent(client, fake_mongo):
    token = _owned_match(client, fake_mongo, status="email_sent")
    for _ in range(2):
        response = client.post(
            "/feedback-status", json={"match_id": "m1", "status": "email_sent"}, headers=auth_header(token)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "email_sent"


@pytest.mark.parametrize("status", ["completed", "pending", "sent", ""])
def test_feedback_status_rejects_other_statuses(client, fake_mongo, status):
    token = _owned_match(client, fake_mongo)
    response = client.post(
        "/feedback-status", json={"match_id": "m1", "status": status}, headers=auth_header(token)
    )
    assert response.status_code == 422
    assert _matches(fake_mongo).find_one({"match_id": "m1"})["status"] == "pending"


def test_feedback_status_unknown_match_is_404(client):
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/feedback-status", json={"match_id": "nope", "status": "email_sent"}, headers=auth_header(token)
    )
    assert response.status_code == 404


def test_feedback_status_on_someone_elses_match_is_403(client, fake_mongo):
    _matches(fake_mongo).insert_one({"match_id": "theirs", "user_id": "someone-else", "status": "pending"})
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/feedback-status", json={"match_id": "theirs", "status": "email_sent"}, headers=auth_header(token)
    )
    assert response.status_code == 403
    assert _matches(fake_mongo).find_one({"match_id": "theirs"})["status"] == "pending"
