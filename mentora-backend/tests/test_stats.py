"""Tests for GET /dashboard/stats and GET /mentor/stats."""
from datetime import datetime, timezone

from tests.conftest import (
    MENTOR_PAYLOAD,
    STARTUP_PAYLOAD,
    auth_header,
    db,
    insert_match,
    me,
    register,
)

OTHER_STARTUP = {**STARTUP_PAYLOAD, "email": "other@example.com"}


def _feedback(fake_mongo, **fields):
    db(fake_mongo)["feedback"].insert_one({"match_id": fields.pop("match_id"), **fields})


def test_dashboard_stats_empty(client):
    token = register(client, STARTUP_PAYLOAD)
    response = client.get("/dashboard/stats", headers=auth_header(token))
    assert response.status_code == 200
    assert response.json() == {"total_matches": 0, "emails_sent": 0, "meetings_accepted": 0, "avg_rating": None}


def test_dashboard_stats_counts_callers_matches(client, fake_mongo):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    for status in ("pending", "emailed", "email_sent", "accepted", "meeting_scheduled", "completed"):
        insert_match(fake_mongo, user_id=user_id, mentor_id="m", status=status)
    insert_match(fake_mongo, user_id=user_id, mentor_id="m", status="declined", email_sent_at="2026-10-01")
    insert_match(fake_mongo, user_id="someone-else", mentor_id="m", status="completed")
    _feedback(fake_mongo, match_id="a", user_id=user_id, mentor_id="m", rating=4)
    _feedback(fake_mongo, match_id="b", user_id=user_id, mentor_id="m", rating=5)
    _feedback(fake_mongo, match_id="c", user_id="someone-else", mentor_id="m", rating=1)

    body = client.get("/dashboard/stats", headers=auth_header(token)).json()
    assert body == {"total_matches": 7, "emails_sent": 5, "meetings_accepted": 3, "avg_rating": 4.5}


def test_dashboard_stats_requires_auth(client):
    assert client.get("/dashboard/stats").status_code == 401


def test_mentor_stats(client, fake_mongo):
    a = me(client, register(client, STARTUP_PAYLOAD))["user_id"]
    b = me(client, register(client, OTHER_STARTUP))["user_id"]
    mentor_token = register(client, MENTOR_PAYLOAD)
    mentor_id = me(client, mentor_token)["mentor_id"]

    fresh = datetime.now(timezone.utc).isoformat()
    # Suggestions (pending/emailed) are invisible to the mentor; email_sent
    # is a (fresh, so not yet expired) request.
    for status in ("pending", "emailed", "email_sent"):
        insert_match(fake_mongo, user_id=a, mentor_id=mentor_id, status=status, requested_at=fresh)
    insert_match(fake_mongo, user_id=a, mentor_id=mentor_id, status="accepted")
    insert_match(fake_mongo, user_id=a, mentor_id=mentor_id, status="meeting_scheduled")
    insert_match(fake_mongo, user_id=a, mentor_id=mentor_id, status="completed")
    insert_match(fake_mongo, user_id=b, mentor_id=mentor_id, status="completed")
    insert_match(fake_mongo, user_id=b, mentor_id=mentor_id, status="declined")
    insert_match(fake_mongo, user_id=b, mentor_id="another-mentor", status="pending")
    _feedback(fake_mongo, match_id="x", user_id=a, mentor_id=mentor_id, rating=3)
    _feedback(fake_mongo, match_id="y", user_id=b, mentor_id=mentor_id, rating=4)
    _feedback(fake_mongo, match_id="z", user_id=b, mentor_id="another-mentor", rating=1)

    response = client.get("/mentor/stats", headers=auth_header(mentor_token))
    assert response.status_code == 200, response.text
    assert response.json() == {"pending_requests": 1, "accepted": 4, "avg_rating": 3.5, "total_helped": 2}

    # The mentor's own dashboard stats are scoped to incoming, requested+ matches.
    dash = client.get("/dashboard/stats", headers=auth_header(mentor_token)).json()
    assert dash["total_matches"] == 6
    assert dash["avg_rating"] == 3.5


def test_mentor_stats_empty_and_forbidden_for_startups(client):
    mentor_token = register(client, MENTOR_PAYLOAD)
    assert client.get("/mentor/stats", headers=auth_header(mentor_token)).json() == {
        "pending_requests": 0, "accepted": 0, "avg_rating": None, "total_helped": 0,
    }
    startup_token = register(client, STARTUP_PAYLOAD)
    assert client.get("/mentor/stats", headers=auth_header(startup_token)).status_code == 403
