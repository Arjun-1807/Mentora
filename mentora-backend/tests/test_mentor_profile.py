"""Tests for PATCH /mentor/profile (mentor onboarding)."""
from bson import ObjectId
import pytest

from app.config import settings
from app.routers.mentor import derive_stage_focus
from tests.conftest import MENTOR_PAYLOAD, STARTUP_PAYLOAD, auth_header, register

VALID = {
    "name": "Ada Lovelace",
    "linkedin_url": "https://www.linkedin.com/in/ada",
    "bio": "Operator turned angel investor.",
    "geography": "Bangalore",
    "sector_expertise": ["FinTech", "SaaS"],
    "years_experience": "10+",
    "past_exits": "Exited Series B SaaS startup in 2021",
    "preferred_stages": ["MVP"],
    "max_startups_per_month": "2",
    "availability": "Weekends",
}


def _db(fake_mongo):
    return fake_mongo[settings.MONGODB_DB_NAME]


@pytest.fixture
def mentor(client):
    token = register(client, MENTOR_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()
    return token, me


def test_requires_authentication(client):
    assert client.patch("/mentor/profile", json=VALID).status_code == 401


def test_startup_accounts_are_forbidden(client):
    token = register(client, STARTUP_PAYLOAD)
    response = client.patch("/mentor/profile", json=VALID, headers=auth_header(token))
    assert response.status_code == 403


def test_success_updates_mentor_and_user_and_reembeds(client, fake_mongo, monkeypatch, mentor):
    from app.routers import mentor as mentor_router

    embedded = []
    monkeypatch.setattr(mentor_router, "embed_passage", lambda text: embedded.append(text) or [0.5] * 768)

    token, me = mentor
    response = client.patch("/mentor/profile", json=VALID, headers=auth_header(token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["mentor_id"] == me["mentor_id"]
    assert "embedding" not in body["profile"]
    assert body["profile"]["domain"] == "FinTech"
    assert body["profile"]["stage_focus"] == "MVP"

    assert len(embedded) == 1
    assert "Bio: Operator turned angel investor." in embedded[0]
    assert "Past exits: Exited Series B SaaS startup in 2021." in embedded[0]

    doc = _db(fake_mongo)[settings.MONGODB_MENTORS_COLLECTION].find_one({"_id": ObjectId(me["mentor_id"])})
    assert doc["embedding"] == [0.5] * 768
    assert doc["name"] == "Ada Lovelace"
    assert doc["domain"] == "FinTech"
    assert doc["expertise"] == ["FinTech", "SaaS"]
    assert doc["preferred_stages"] == ["MVP"]
    assert doc["geography"] == "Bangalore"
    assert doc["email"] == MENTOR_PAYLOAD["email"]
    assert doc["onboarding_completed"] is True

    user = _db(fake_mongo)[settings.MONGODB_USERS_COLLECTION].find_one({"_id": ObjectId(me["user_id"])})
    assert user["profile"]["name"] == "Ada Lovelace"
    assert user["profile"]["availability"] == "Weekends"


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"name": ""}, "name"),
        ({"name": "x" * 101}, "name"),
        ({"linkedin_url": "linkedin.com/in/ada"}, "linkedin_url"),
        ({"linkedin_url": "ftp://example.com/x"}, "linkedin_url"),
        ({"bio": "x" * 301}, "bio"),
        ({"geography": "Pune"}, "geography"),
        ({"sector_expertise": []}, "sector_expertise"),
        ({"sector_expertise": ["Crypto"]}, "sector_expertise"),
        ({"years_experience": "20"}, "years_experience"),
        ({"past_exits": "x" * 301}, "past_exits"),
        ({"preferred_stages": []}, "preferred_stages"),
        ({"preferred_stages": ["seed"]}, "preferred_stages"),
        ({"max_startups_per_month": "4"}, "max_startups_per_month"),
        ({"availability": "Evenings"}, "availability"),
    ],
)
def test_invalid_input_is_422(client, mentor, overrides, field):
    token, _ = mentor
    response = client.patch("/mentor/profile", json={**VALID, **overrides}, headers=auth_header(token))
    assert response.status_code == 422
    assert field in response.json()["error"]


def test_optional_fields_may_be_blank(client, mentor):
    token, _ = mentor
    payload = {**VALID, "linkedin_url": "", "bio": "  ", "past_exits": None}
    response = client.patch("/mentor/profile", json=payload, headers=auth_header(token))
    assert response.status_code == 200
    profile = response.json()["profile"]
    assert profile["linkedin_url"] is None and profile["bio"] is None and profile["past_exits"] is None


def test_mentor_without_linked_document_is_404(client, fake_mongo, mentor):
    token, me = mentor
    _db(fake_mongo)[settings.MONGODB_MENTORS_COLLECTION].delete_many({})
    response = client.patch("/mentor/profile", json=VALID, headers=auth_header(token))
    assert response.status_code == 404


@pytest.mark.parametrize(
    "stages, expected",
    [
        (["MVP"], "MVP"),
        (["idea"], "idea"),
        (["idea", "MVP"], "all"),
        (["all"], "all"),
        (["growth", "all"], "all"),
    ],
)
def test_derive_stage_focus(stages, expected):
    assert derive_stage_focus(stages) == expected


def test_stages_and_sectors_are_deduplicated(client, mentor):
    token, _ = mentor
    payload = {**VALID, "preferred_stages": ["MVP", "MVP"], "sector_expertise": ["SaaS", "SaaS"]}
    response = client.patch("/mentor/profile", json=payload, headers=auth_header(token))
    profile = response.json()["profile"]
    assert profile["preferred_stages"] == ["MVP"]
    assert profile["sector_expertise"] == ["SaaS"]
