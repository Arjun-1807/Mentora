"""
Shared pytest fixtures.

The whole suite runs offline: MongoDB is replaced with `mongomock`, the
sentence-transformers embedding model and every Groq call are patched out,
and a deterministic JWT secret is injected before the app is imported.
"""
import os
from typing import List

import mongomock
import pytest

# Must be set before app.config is imported: env vars take precedence over
# .env, so the suite never depends on the developer's real secret.
os.environ.setdefault("JWT_SECRET", "t" * 64)
os.environ["MONGODB_URI"] = "mongodb://localhost:27017"

from fastapi.testclient import TestClient  # noqa: E402

from app import main as app_main  # noqa: E402
from app.db import mongo as mongo_module  # noqa: E402
from app.services import rate_limit  # noqa: E402

EMBEDDING_DIM = 768


def fake_embedding(_text: str) -> List[float]:
    """Deterministic stand-in for a real 768-dim BGE embedding."""
    return [0.01] * EMBEDDING_DIM


@pytest.fixture(autouse=True)
def fake_mongo(monkeypatch):
    """Point every app.db.mongo accessor at a fresh in-memory mongomock client."""
    client = mongomock.MongoClient()
    monkeypatch.setattr(mongo_module, "get_mongo_client", lambda: client)
    return client


@pytest.fixture(autouse=True)
def no_embedding_model(monkeypatch):
    """Never load (or download) the real embedding model in tests."""
    from app.routers import auth as auth_router
    from app.routers import mentor as mentor_router
    from app.services import embeddings, mentor_matching

    monkeypatch.setattr(embeddings, "embed_passage", fake_embedding)
    monkeypatch.setattr(embeddings, "embed_query", fake_embedding)
    monkeypatch.setattr(auth_router, "embed_passage", fake_embedding)
    monkeypatch.setattr(mentor_router, "embed_passage", fake_embedding)
    monkeypatch.setattr(mentor_matching, "embed_query", fake_embedding)


@pytest.fixture(autouse=True)
def no_groq_deck_feedback(monkeypatch):
    """/extract's second (deck feedback) Groq call never hits the network in
    tests; by default it fails, so /extract returns the default feedback.
    Tests that need real feedback monkeypatch `llm._call_groq_feedback`."""
    from fastapi import HTTPException

    from app.services import llm

    def unavailable(_prompt):
        raise HTTPException(status_code=502, detail="Deck feedback is unavailable.")

    monkeypatch.setattr(llm, "_call_groq_feedback", unavailable)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Rate-limit state is process-global; clear it between tests."""
    rate_limit.reset_all_limiters()
    yield
    rate_limit.reset_all_limiters()


@pytest.fixture
def client(fake_mongo):
    """TestClient with the app's lifespan (index creation) executed."""
    with TestClient(app_main.app) as test_client:
        yield test_client


# --- convenience helpers ----------------------------------------------------

STARTUP_PAYLOAD = {
    "email": "founder@example.com",
    "password": "correct-horse",
    "role": "startup",
    "profile": {"company": "Acme"},
}

MENTOR_PAYLOAD = {
    "email": "mentor@example.com",
    "password": "correct-horse",
    "role": "mentor",
    "profile": {
        "name": "Ada Mentor",
        "sector_expertise": ["FinTech"],
        "domain": "Fintech",
        "stage_focus": "MVP",
        "expertise": ["Fundraising"],
        "geography": "Remote",
    },
}

COORDINATOR_PAYLOAD = {
    "email": "coord@example.com",
    "password": "correct-horse",
    "role": "coordinator",
}

# A pitch-deck text comfortably above /extract's 100-character minimum.
DECK_TEXT = (
    "Acme is a Fintech startup at MVP stage. We help small merchants in India "
    "reconcile UPI payments automatically and are raising a seed round."
)


def register(client, payload) -> str:
    """Register a user and return their bearer token."""
    response = client.post("/register", json=payload)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def seed_mentor(fake_mongo, **fields) -> str:
    """Insert a minimal mentor document so /match and /evaluate don't 404."""
    from app.config import settings

    doc = {"name": "Seed Mentor", "domain": "Fintech", "stage_focus": "MVP", "expertise": ["Fundraising"]}
    doc.update(fields)
    collection = fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MENTORS_COLLECTION]
    return str(collection.insert_one(doc).inserted_id)


def db(fake_mongo):
    from app.config import settings

    return fake_mongo[settings.MONGODB_DB_NAME]


def me(client, token) -> dict:
    response = client.get("/me", headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()


def insert_match(fake_mongo, *, user_id: str, mentor_id: str, status: str = "pending", **fields) -> dict:
    """Insert a match document directly and return it (with its _id)."""
    from uuid import uuid4

    from app.config import settings

    doc = {
        "match_id": str(uuid4()),
        # Unique per doc so the (user_id, mentor_id, fingerprint) index allows several.
        "profile_fingerprint": uuid4().hex,
        "user_id": user_id,
        "mentor_id": mentor_id,
        "status": status,
        "score": 0.8,
        "startup_profile": {"domain": "Fintech", "stage": "MVP", "challenges": [], "team_gaps": []},
        "timestamp": "2026-10-01T10:00:00+00:00",
    }
    doc.update(fields)
    fake_mongo[settings.MONGODB_DB_NAME][settings.MONGODB_MATCHES_COLLECTION].insert_one(doc)
    return doc


def coordinator_invite(email: str = COORDINATOR_PAYLOAD["email"], cohort_id: str = None) -> str:
    """Create a coordinator invite (legacy default cohort unless given) and
    return its raw token. Coordinators can only register with one."""
    from app.db.mongo import get_cohorts_collection
    from app.services import tenancy

    if cohort_id is None:
        org_id, cohort_id = tenancy.ensure_legacy_org()
    else:
        org_id = get_cohorts_collection().find_one({"_id": tenancy.object_id(cohort_id)})["org_id"]
    token, _ = tenancy.create_invite(org_id=org_id, cohort_id=cohort_id, role="coordinator", email=email)
    return token


def register_coordinator(client, payload: dict = None, cohort_id: str = None) -> str:
    """Register a coordinator through an invite and return their bearer token."""
    payload = payload or COORDINATOR_PAYLOAD
    token = coordinator_invite(payload["email"], cohort_id)
    return register(client, {**payload, "invite_token": token})
