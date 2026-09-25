"""Tests for the structured error format and LLM failure handling."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main as app_main
from app.models.schemas import MentorMatch, StartupProfile
from app.services import email_gen, llm
from tests.conftest import STARTUP_PAYLOAD, auth_header, register

PROFILE = StartupProfile(domain="Fintech", stage="MVP", challenges=["Runway"])
MENTOR = MentorMatch(
    mentor_id="m1", name="Ava", domain="Fintech", stage_focus="MVP", expertise=["Fundraising"], match_score=0.9
)
VALID_JSON = '{"domain": "Fintech", "stage": "MVP", "challenges": [], "team_gaps": []}'


# --- error format -----------------------------------------------------------

def test_http_errors_carry_error_and_detail(client):
    response = client.get("/me")
    assert response.status_code == 401
    body = response.json()
    assert body["error"] == body["detail"] == "Missing Authorization header."


def test_validation_errors_carry_a_readable_error_string(client):
    response = client.post("/login", json={"email": "not-an-email"})
    assert response.status_code == 422
    body = response.json()
    assert isinstance(body["error"], str) and "email" in body["error"] and "password" in body["error"]
    assert isinstance(body["detail"], list)


def test_validation_errors_never_echo_submitted_values(client):
    payload = {**STARTUP_PAYLOAD, "password": "Zq9x"}
    response = client.post("/register", json=payload)
    assert response.status_code == 422
    assert "Zq9x" not in response.text
    assert all("input" not in item for item in response.json()["detail"])


def test_rate_limit_error_keeps_retry_after_header(client, monkeypatch):
    from app.services import rate_limit

    monkeypatch.setattr(rate_limit.login_limiter, "limit", 1)
    body = {"email": "a@example.com", "password": "x"}
    client.post("/login", json=body)
    response = client.post("/login", json=body)
    assert response.status_code == 429
    assert response.headers.get("Retry-After")
    assert response.json()["error"] == "Too many requests. Please try again later."


def test_unhandled_exceptions_return_generic_500_without_traceback(monkeypatch):
    from app.routers import match as match_router

    def boom(_):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(match_router, "ensure_mentors_exist", lambda: None)
    monkeypatch.setattr(match_router, "find_matching_mentors", boom)
    with TestClient(app_main.app, raise_server_exceptions=False) as client:
        token = register(client, STARTUP_PAYLOAD)
        response = client.post(
            "/match", json={"domain": "Fintech", "stage": "MVP"}, headers=auth_header(token)
        )
    assert response.status_code == 500
    assert response.json() == {"error": "Internal server error.", "detail": "Internal server error."}
    assert "secret" not in response.text and "Traceback" not in response.text


# --- /extract LLM retry -----------------------------------------------------

def test_extract_retries_once_with_strict_prompt(monkeypatch):
    calls = []

    def fake_call(text, system_prompt=llm.SYSTEM_PROMPT, temperature=0.2):
        calls.append(system_prompt)
        return "not json" if len(calls) == 1 else VALID_JSON

    monkeypatch.setattr(llm, "_call_groq", fake_call)
    profile = llm.extract_startup_profile("deck text")
    assert profile.domain == "Fintech"
    assert calls == [llm.SYSTEM_PROMPT, llm.STRICT_SYSTEM_PROMPT]


def test_extract_returns_500_after_strict_retry_fails(monkeypatch):
    calls = []

    def fake_call(text, system_prompt=llm.SYSTEM_PROMPT, temperature=0.2):
        calls.append(system_prompt)
        return '{"domain": "Fintech", "stage": "seed"}'  # fails schema validation

    monkeypatch.setattr(llm, "_call_groq", fake_call)
    with pytest.raises(HTTPException) as exc_info:
        llm.extract_startup_profile("deck text")
    assert exc_info.value.status_code == 500
    assert len(calls) == 2


def test_extract_does_not_retry_a_valid_response(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_call_groq", lambda text, **kw: calls.append(1) or VALID_JSON)
    llm.extract_startup_profile("deck text")
    assert len(calls) == 1


# --- /email 503 -------------------------------------------------------------

def test_email_missing_api_key_is_503(monkeypatch):
    monkeypatch.setattr(email_gen.settings, "GROQ_API_KEY", "")
    with pytest.raises(HTTPException) as exc_info:
        email_gen.generate_intro_email(PROFILE, MENTOR)
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Email generation unavailable. Please try again."


def test_email_groq_error_is_503(monkeypatch):
    class Exploding:
        class chat:
            class completions:
                @staticmethod
                def create(**_):
                    raise RuntimeError("groq down")

    monkeypatch.setattr(email_gen, "_get_client", lambda: Exploding())
    with pytest.raises(HTTPException) as exc_info:
        email_gen.generate_intro_email(PROFILE, MENTOR)
    assert exc_info.value.status_code == 503


def test_email_unparseable_after_retry_is_503(monkeypatch):
    monkeypatch.setattr(email_gen, "_call_groq", lambda *_: "not json")
    with pytest.raises(HTTPException) as exc_info:
        email_gen.generate_intro_email(PROFILE, MENTOR)
    assert exc_info.value.status_code == 503


def test_email_endpoint_surfaces_503_as_structured_json(client, monkeypatch):
    monkeypatch.setattr(email_gen.settings, "GROQ_API_KEY", "")
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/email",
        json={"startup_profile": PROFILE.model_dump(), "mentor": MENTOR.model_dump()},
        headers=auth_header(token),
    )
    assert response.status_code == 503
    assert response.json()["error"] == "Email generation unavailable. Please try again."
