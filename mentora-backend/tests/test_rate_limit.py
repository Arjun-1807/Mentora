"""Tests for the in-process rate limiter and its use on /login and /extract."""
import pytest

from app.services import rate_limit
from app.services.rate_limit import SlidingWindowRateLimiter
from tests.conftest import STARTUP_PAYLOAD, auth_header, register


def test_sliding_window_allows_up_to_the_limit_then_blocks():
    limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
    assert [limiter.check("k") for _ in range(3)] == [None, None, None]

    retry_after = limiter.check("k")
    assert retry_after is not None and retry_after >= 1


def test_sliding_window_keys_are_independent():
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    assert limiter.check("a") is None
    assert limiter.check("b") is None
    assert limiter.check("a") is not None


def test_sliding_window_forgets_expired_hits():
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=0.01)
    assert limiter.check("k") is None
    assert limiter.check("k") is not None

    import time

    time.sleep(0.02)
    assert limiter.check("k") is None


def test_reset_clears_state():
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    limiter.check("k")
    assert limiter.check("k") is not None
    limiter.reset("k")
    assert limiter.check("k") is None


def test_login_is_rate_limited_per_ip(client, monkeypatch):
    register(client, STARTUP_PAYLOAD)
    monkeypatch.setattr(rate_limit.login_limiter, "limit", 3)

    body = {"email": STARTUP_PAYLOAD["email"], "password": "wrong-password"}
    statuses = [client.post("/login", json=body).status_code for _ in range(4)]

    assert statuses[:3] == [401, 401, 401]
    assert statuses[3] == 429

    blocked = client.post("/login", json=body)
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"]
    assert blocked.json()["detail"] == "Too many requests. Please try again later."


def test_login_limit_does_not_leak_between_ips(client, monkeypatch):
    register(client, STARTUP_PAYLOAD)
    monkeypatch.setattr(rate_limit.login_limiter, "limit", 1)

    body = {"email": STARTUP_PAYLOAD["email"], "password": "wrong-password"}
    assert client.post("/login", json=body, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 401
    assert client.post("/login", json=body, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 429
    assert client.post("/login", json=body, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 401


def test_extract_is_rate_limited_per_user(client, monkeypatch, text_pdf_bytes):
    from app.routers import extract as extract_router
    from app.models.schemas import StartupProfile

    monkeypatch.setattr(
        extract_router,
        "extract_startup_profile",
        lambda text: StartupProfile(domain="Fintech", stage="MVP"),
    )
    monkeypatch.setattr(rate_limit.llm_limiter, "limit", 2)

    token = register(client, STARTUP_PAYLOAD)

    def call():
        return client.post(
            "/extract",
            files={"file": ("deck.pdf", text_pdf_bytes, "application/pdf")},
            headers=auth_header(token),
        )

    assert call().status_code == 200
    assert call().status_code == 200
    assert call().status_code == 429


def test_rate_limiting_can_be_disabled(monkeypatch):
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    monkeypatch.setattr(rate_limit.settings, "RATE_LIMIT_ENABLED", False)
    for _ in range(5):
        rate_limit._enforce(limiter, "k", "test")  # no exception


@pytest.fixture
def text_pdf_bytes():
    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Acme is a Fintech startup at MVP stage.")
    data = document.tobytes()
    document.close()
    return data
