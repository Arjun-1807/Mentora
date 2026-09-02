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
    from app.services import embeddings, mentor_matching

    monkeypatch.setattr(embeddings, "embed_passage", fake_embedding)
    monkeypatch.setattr(embeddings, "embed_query", fake_embedding)
    monkeypatch.setattr(auth_router, "embed_passage", fake_embedding)
    monkeypatch.setattr(mentor_matching, "embed_query", fake_embedding)


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
        "domain": "Fintech",
        "stage_focus": "MVP",
        "expertise": ["Fundraising"],
        "geography": "Remote",
    },
}


def register(client, payload) -> str:
    """Register a user and return their bearer token."""
    response = client.post("/register", json=payload)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
