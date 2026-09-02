"""Tests for /register, /login and /me."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings
from tests.conftest import MENTOR_PAYLOAD, STARTUP_PAYLOAD, auth_header, register


def test_register_returns_token(client):
    response = client.post("/register", json=STARTUP_PAYLOAD)
    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert response.json()["access_token"]


def test_register_duplicate_email_rejected(client):
    register(client, STARTUP_PAYLOAD)
    response = client.post("/register", json=STARTUP_PAYLOAD)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_register_duplicate_email_rejected_by_unique_index(client, monkeypatch):
    """Even if the pre-check is bypassed (the check-then-insert race), the
    unique index on users.email turns the duplicate into a clean 400."""
    register(client, STARTUP_PAYLOAD)

    from app.routers import auth as auth_router

    users = auth_router.get_users_collection()
    monkeypatch.setattr(
        auth_router, "get_users_collection", lambda: _NoPrecheck(users)
    )

    response = client.post("/register", json=STARTUP_PAYLOAD)
    assert response.status_code == 400


class _NoPrecheck:
    """Collection wrapper whose find_one always misses, simulating the race."""

    def __init__(self, wrapped):
        self._wrapped = wrapped

    def find_one(self, *args, **kwargs):
        return None

    def __getattr__(self, item):
        return getattr(self._wrapped, item)


@pytest.mark.parametrize("password", ["short", "1234567"])
def test_register_rejects_short_password(client, password):
    payload = {**STARTUP_PAYLOAD, "password": password}
    response = client.post("/register", json=payload)
    assert response.status_code == 422


def test_register_rejects_password_over_bcrypt_limit(client):
    payload = {**STARTUP_PAYLOAD, "password": "a" * 73}
    response = client.post("/register", json=payload)
    assert response.status_code == 422
    assert "72" in response.text


def test_login_success_and_wrong_password(client):
    register(client, STARTUP_PAYLOAD)

    ok = client.post("/login", json={"email": STARTUP_PAYLOAD["email"], "password": STARTUP_PAYLOAD["password"]})
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    bad = client.post("/login", json={"email": STARTUP_PAYLOAD["email"], "password": "wrong-password"})
    assert bad.status_code == 401
    assert bad.json()["detail"] == "Invalid email or password."


def test_login_unknown_email(client):
    response = client.post("/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert response.status_code == 401


def test_me_returns_profile_without_password_hash(client):
    token = register(client, STARTUP_PAYLOAD)
    response = client.get("/me", headers=auth_header(token))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == STARTUP_PAYLOAD["email"]
    assert body["role"] == "startup"
    assert body["profile"] == {"company": "Acme"}
    assert "password_hash" not in response.text


def test_me_requires_token(client):
    assert client.get("/me").status_code == 401


def test_me_rejects_invalid_token(client):
    response = client.get("/me", headers=auth_header("not-a-jwt"))
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid access token."


def test_me_rejects_expired_token(client):
    register(client, STARTUP_PAYLOAD)
    expired = jwt.encode(
        {
            "sub": "507f1f77bcf86cd799439011",
            "role": "startup",
            "iat": datetime.now(timezone.utc) - timedelta(hours=2),
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    response = client.get("/me", headers=auth_header(expired))
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_me_rejects_token_signed_with_another_secret(client):
    forged = jwt.encode({"sub": "x", "role": "startup"}, "some-other-secret", algorithm="HS256")
    assert client.get("/me", headers=auth_header(forged)).status_code == 401


def test_mentor_registration_creates_linked_mentor_document(client, fake_mongo):
    token = register(client, MENTOR_PAYLOAD)
    me = client.get("/me", headers=auth_header(token)).json()

    assert me["role"] == "mentor"
    assert me["mentor_id"]

    from bson import ObjectId

    mentor_doc = fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MENTORS_COLLECTION].find_one(
        {"_id": ObjectId(me["mentor_id"])}
    )
    assert mentor_doc is not None
    assert mentor_doc["domain"] == "Fintech"
    assert len(mentor_doc["embedding"]) == 768
    # Cross-linked back to the user account.
    assert mentor_doc["user_id"] == me["user_id"]


@pytest.mark.parametrize(
    "profile",
    [
        {},
        {"name": "No Domain", "stage_focus": "MVP", "expertise": ["X"]},
        {"name": "No Stage", "domain": "Fintech", "expertise": ["X"]},
        {"name": "Bad Stage", "domain": "Fintech", "stage_focus": "seed", "expertise": ["X"]},
        {"name": "No Expertise", "domain": "Fintech", "stage_focus": "MVP", "expertise": []},
    ],
)
def test_mentor_registration_requires_valid_profile(client, profile, fake_mongo):
    payload = {**MENTOR_PAYLOAD, "profile": profile}
    response = client.post("/register", json=payload)
    assert response.status_code == 422
    assert "stage_focus" in response.json()["detail"]

    # Nothing was persisted for the rejected registration.
    db = fake_mongo[settings.MONGODB_DB_NAME]
    assert db[settings.MONGODB_USERS_COLLECTION].count_documents({}) == 0
    assert db[settings.MONGODB_MENTORS_COLLECTION].count_documents({}) == 0


def test_mentor_insert_failure_rolls_back_user(client, fake_mongo, monkeypatch):
    """A failed user insert must not leave an orphaned mentor document."""
    from app.routers import auth as auth_router

    monkeypatch.setattr(auth_router, "get_users_collection", lambda: _ExplodingInsert())

    response = client.post("/register", json=MENTOR_PAYLOAD)
    assert response.status_code == 502

    db = fake_mongo[settings.MONGODB_DB_NAME]
    assert db[settings.MONGODB_MENTORS_COLLECTION].count_documents({}) == 0


class _ExplodingInsert:
    def find_one(self, *args, **kwargs):
        return None

    def insert_one(self, *args, **kwargs):
        raise RuntimeError("mongo down")
