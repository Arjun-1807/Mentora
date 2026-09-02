"""Tests for match-record de-duplication and the status lifecycle."""
from app.config import settings
from app.models.schemas import EmailResponse, MentorMatch, StartupProfile
from app.services.matches import profile_fingerprint
from tests.conftest import STARTUP_PAYLOAD, auth_header, register

PROFILE = {
    "domain": "Fintech",
    "stage": "MVP",
    "challenges": ["Customer acquisition"],
    "team_gaps": ["No CTO"],
    "geography": "San Francisco, CA",
}


def _matches(fake_mongo):
    return fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MATCHES_COLLECTION]


def _fake_matches():
    return [
        MentorMatch(
            mentor_id=f"mentor-{i}",
            name=f"Mentor {i}",
            domain="Fintech",
            stage_focus="MVP",
            expertise=["Fundraising"],
            match_score=0.9 - i / 100,
        )
        for i in range(5)
    ]


def test_fingerprint_is_order_and_case_insensitive():
    a = StartupProfile(domain="Fintech", stage="MVP", challenges=["A", "b"], team_gaps=["x"])
    b = StartupProfile(domain=" fintech ", stage="MVP", challenges=["B", "a"], team_gaps=["X"])
    c = StartupProfile(domain="HealthTech", stage="MVP", challenges=["A", "b"], team_gaps=["x"])

    assert profile_fingerprint(a) == profile_fingerprint(b)
    assert profile_fingerprint(a) != profile_fingerprint(c)


def test_match_records_are_scoped_and_deduplicated(client, fake_mongo, monkeypatch):
    from app.routers import match as match_router

    monkeypatch.setattr(match_router, "find_matching_mentors", lambda profile: _fake_matches())

    token = register(client, STARTUP_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()

    first = client.post("/match", json=PROFILE, headers=auth_header(token))
    assert first.status_code == 200
    match_ids = [item["match_id"] for item in first.json()["matches"]]
    assert all(match_ids)
    assert _matches(fake_mongo).count_documents({}) == 5
    assert _matches(fake_mongo).count_documents({"user_id": me["user_id"]}) == 5

    # Re-matching the identical profile refreshes rather than duplicates.
    second = client.post("/match", json=PROFILE, headers=auth_header(token))
    assert _matches(fake_mongo).count_documents({}) == 5
    assert [item["match_id"] for item in second.json()["matches"]] == match_ids

    # A different profile creates its own records.
    other = {**PROFILE, "domain": "HealthTech"}
    client.post("/match", json=other, headers=auth_header(token))
    assert _matches(fake_mongo).count_documents({}) == 10


def test_match_requires_authentication(client):
    assert client.post("/match", json=PROFILE).status_code == 401


def test_email_advances_match_to_emailed(client, fake_mongo, monkeypatch):
    from app.routers import email as email_router
    from app.routers import match as match_router

    monkeypatch.setattr(match_router, "find_matching_mentors", lambda profile: _fake_matches())
    monkeypatch.setattr(
        email_router,
        "generate_intro_email",
        lambda profile, mentor: EmailResponse(subject="Hi", body="Body"),
    )

    token = register(client, STARTUP_PAYLOAD)
    matches = client.post("/match", json=PROFILE, headers=auth_header(token)).json()["matches"]
    match_id = matches[0]["match_id"]
    assert _matches(fake_mongo).find_one({"match_id": match_id})["status"] == "pending"

    response = client.post(
        "/email",
        json={"startup_profile": PROFILE, "mentor": matches[0], "match_id": match_id},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert response.json()["subject"] == "Hi"
    assert _matches(fake_mongo).find_one({"match_id": match_id})["status"] == "emailed"


def test_email_without_match_id_still_works(client, monkeypatch):
    """match_id stays optional so existing callers do not break."""
    from app.routers import email as email_router

    monkeypatch.setattr(
        email_router,
        "generate_intro_email",
        lambda profile, mentor: EmailResponse(subject="Hi", body="Body"),
    )

    token = register(client, STARTUP_PAYLOAD)
    mentor = _fake_matches()[0].model_dump()
    mentor.pop("match_id", None)

    response = client.post(
        "/email",
        json={"startup_profile": PROFILE, "mentor": mentor},
        headers=auth_header(token),
    )
    assert response.status_code == 200


def test_email_cannot_advance_another_users_match(client, fake_mongo, monkeypatch):
    from app.routers import email as email_router

    monkeypatch.setattr(
        email_router,
        "generate_intro_email",
        lambda profile, mentor: EmailResponse(subject="Hi", body="Body"),
    )

    _matches(fake_mongo).insert_one(
        {
            "match_id": "someone-else",
            "user_id": "507f1f77bcf86cd799439011",
            "mentor_id": "mentor-0",
            "status": "pending",
        }
    )

    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/email",
        json={"startup_profile": PROFILE, "mentor": _fake_matches()[0].model_dump(), "match_id": "someone-else"},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert _matches(fake_mongo).find_one({"match_id": "someone-else"})["status"] == "pending"


def test_status_never_regresses(client, fake_mongo):
    from app.services.matches import advance_match_status

    _matches(fake_mongo).insert_one(
        {"match_id": "m", "user_id": "u", "mentor_id": "x", "status": "completed"}
    )
    assert advance_match_status("m", "u", "emailed") is False
    assert _matches(fake_mongo).find_one({"match_id": "m"})["status"] == "completed"
    assert advance_match_status(None, "u", "emailed") is False
