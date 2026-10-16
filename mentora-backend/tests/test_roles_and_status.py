"""Tests for the coordinator role, the extended match status vocabulary,
match-doc enrichment (mentor_name / startup_email) and structured errors."""
from fastapi import HTTPException

from app import main as app_main
from app.models.schemas import MentorMatch
from app.services.matches import MATCH_STATUS_ORDER, advance_match_status
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
    seed_mentor,
)


# --- coordinator role ---------------------------------------------------------

def test_coordinator_can_register_login_and_me(client):
    token = register_coordinator(client)
    profile = me(client, token)
    assert profile["role"] == "coordinator"
    assert profile["profile"] == {}
    assert profile["calendar_connected"] is False

    login = client.post(
        "/login", json={"email": COORDINATOR_PAYLOAD["email"], "password": COORDINATOR_PAYLOAD["password"]}
    )
    assert login.status_code == 200
    assert me(client, login.json()["access_token"])["role"] == "coordinator"


def test_unknown_role_is_rejected(client):
    response = client.post("/register", json={**COORDINATOR_PAYLOAD, "role": "admin"})
    assert response.status_code == 422


def test_me_reports_calendar_connected(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    user = me(client, token)
    assert user["calendar_connected"] is False

    from bson import ObjectId

    db(fake_mongo)["users"].update_one(
        {"_id": ObjectId(user["user_id"])}, {"$set": {"google_calendar": {"refresh_token": "r"}}}
    )
    body = me(client, token)
    assert body["calendar_connected"] is True
    assert "google_calendar" not in body and "refresh_token" not in str(body)


# --- status vocabulary ----------------------------------------------------------

def test_status_order_matches_contract():
    assert MATCH_STATUS_ORDER == [
        "suggested", "requested", "accepted", "meeting_scheduled", "met", "completed"
    ]


def test_status_advances_forward_through_new_states(fake_mongo):
    matches = db(fake_mongo)["matches"]
    matches.insert_one({"match_id": "m", "user_id": "u", "mentor_id": "x", "status": "pending"})
    for status in MATCH_STATUS_ORDER[1:]:
        assert advance_match_status("m", "u", status) is True
        assert matches.find_one({"match_id": "m"})["status"] == status
    # Never regresses.
    assert advance_match_status("m", "u", "accepted") is False
    assert matches.find_one({"match_id": "m"})["status"] == "completed"


def test_email_sent_does_not_regress_an_accepted_match(fake_mongo):
    matches = db(fake_mongo)["matches"]
    matches.insert_one({"match_id": "m", "user_id": "u", "mentor_id": "x", "status": "accepted"})
    assert advance_match_status("m", "u", "email_sent") is False
    assert matches.find_one({"match_id": "m"})["status"] == "accepted"


def _feedback(client, token, match):
    return client.post(
        "/feedback",
        json={"match_id": match["match_id"], "mentor_id": match["mentor_id"], "attended": True, "rating": 5},
        headers=auth_header(token),
    )


def test_feedback_completes_scheduled_and_met_matches(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    mentor_id = seed_mentor(fake_mongo)
    for status in ("meeting_scheduled", "met"):
        match = insert_match(fake_mongo, user_id=user_id, mentor_id=mentor_id, status=status)
        response = _feedback(client, token, match)
        assert response.status_code == 200, response.text
        doc = db(fake_mongo)["matches"].find_one({"match_id": match["match_id"]})
        assert doc["status"] == "completed"
        assert doc["history"][-1]["to"] == "completed"


def test_feedback_needs_a_meeting(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    mentor_id = seed_mentor(fake_mongo)
    for status in ("pending", "suggested", "requested", "accepted", "declined", "withdrawn"):
        match = insert_match(fake_mongo, user_id=user_id, mentor_id=mentor_id, status=status)
        assert _feedback(client, token, match).status_code == 409, status
        assert db(fake_mongo)["matches"].find_one({"match_id": match["match_id"]})["status"] == status
    assert db(fake_mongo)["feedback"].count_documents({}) == 0


def test_mentor_accept_and_decline_still_work(client, fake_mongo):
    mentor_token = register(client, MENTOR_PAYLOAD)
    mentor_id = me(client, mentor_token)["mentor_id"]
    match = insert_match(fake_mongo, user_id="507f1f77bcf86cd799439011", mentor_id=mentor_id, status="requested")
    response = client.patch(
        f"/mentor/matches/{match['_id']}", json={"status": "accepted"}, headers=auth_header(mentor_token)
    )
    assert response.status_code == 200
    assert db(fake_mongo)["matches"].find_one({"_id": match["_id"]})["status"] == "accepted"


# --- enrichment ------------------------------------------------------------------

def test_match_stores_mentor_name_and_email(client, fake_mongo, monkeypatch):
    from app.routers import match as match_router

    mentor_id = seed_mentor(fake_mongo, name="Grace", email="grace@example.com")
    monkeypatch.setattr(
        match_router,
        "find_matching_mentors",
        lambda profile: [
            MentorMatch(
                mentor_id=mentor_id, name="Grace", domain="Fintech", stage_focus="MVP",
                expertise=["Payments"], match_score=0.9, email="grace@example.com",
            )
        ],
    )
    token = register(client, STARTUP_PAYLOAD)
    response = client.post("/match", json={"domain": "Fintech", "stage": "MVP"}, headers=auth_header(token))
    assert response.status_code == 200
    doc = db(fake_mongo)["matches"].find_one({"mentor_id": mentor_id})
    assert doc["mentor_name"] == "Grace"
    assert doc["mentor_email"] == "grace@example.com"


def test_matches_all_backfills_mentor_name_for_legacy_docs(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    mentor_id = seed_mentor(fake_mongo, name="Legacy Larry")
    insert_match(fake_mongo, user_id=user_id, mentor_id=mentor_id)  # no mentor_name stored
    insert_match(fake_mongo, user_id=user_id, mentor_id="not-an-object-id")
    insert_match(
        fake_mongo, user_id=user_id, mentor_id=mentor_id, mentor_name="Stored Name",
        meeting={"date": "2026-11-02"}, health_logged_by=["startup"], timestamp="2026-10-02T10:00:00+00:00",
    )

    response = client.post("/matches/all", headers=auth_header(token))
    assert response.status_code == 200
    docs = response.json()["matches"]
    assert [d["mentor_name"] for d in docs] == ["Stored Name", "Legacy Larry", None]
    assert docs[0]["meeting"] == {"date": "2026-11-02"}
    assert docs[0]["health_logged_by"] == ["startup"]


def test_mentor_matches_include_startup_email_and_mentor_name(client, fake_mongo):
    startup_token = register(client, STARTUP_PAYLOAD)
    startup_id = me(client, startup_token)["user_id"]
    mentor_token = register(client, MENTOR_PAYLOAD)
    mentor_id = me(client, mentor_token)["mentor_id"]
    from datetime import datetime, timezone

    fresh = datetime.now(timezone.utc).isoformat()  # not yet expired
    insert_match(fake_mongo, user_id=startup_id, mentor_id=mentor_id, status="email_sent", requested_at=fresh)
    insert_match(fake_mongo, user_id=startup_id, mentor_id=mentor_id, status="accepted")

    # Legacy spellings still filter (email_sent == requested).
    response = client.get(
        "/mentor/matches", params={"status": "pending,emailed,email_sent"}, headers=auth_header(mentor_token)
    )
    assert response.status_code == 200
    docs = response.json()["matches"]
    assert len(docs) == 1
    assert docs[0]["status"] == "requested"
    assert docs[0]["startup_email"] is None  # not before the mentor accepts
    assert docs[0]["mentor_name"] == MENTOR_PAYLOAD["profile"]["name"]

    accepted = client.get(
        "/mentor/matches", params={"status": "accepted"}, headers=auth_header(mentor_token)
    ).json()["matches"]
    assert [d["startup_email"] for d in accepted] == [STARTUP_PAYLOAD["email"]]


# --- structured error pass-through --------------------------------------------------

def test_dict_http_exception_details_keep_extra_keys():
    from fastapi.testclient import TestClient

    @app_main.app.get("/__test_structured_error")
    async def _boom():
        raise HTTPException(
            status_code=403, detail={"error": "calendar_not_connected", "user": "mentor", "detail": "Nope."}
        )

    try:
        with TestClient(app_main.app) as test_client:
            response = test_client.get("/__test_structured_error")
    finally:
        app_main.app.router.routes = [
            r for r in app_main.app.router.routes if getattr(r, "path", None) != "/__test_structured_error"
        ]
    assert response.status_code == 403
    assert response.json() == {"error": "calendar_not_connected", "user": "mentor", "detail": "Nope."}
