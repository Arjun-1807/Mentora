"""Tests for /extract's deck_feedback (Section 4) and its never-fail fallback."""
import json

import pymupdf
import pytest
from fastapi import HTTPException

from app.models.schemas import DeckFeedback, StartupProfile
from app.services import llm
from tests.conftest import DECK_TEXT, STARTUP_PAYLOAD, auth_header, register

PROFILE = StartupProfile(domain="Clean Energy", stage="MVP", challenges=["Hardware costs"], team_gaps=[])
# Captured at import time, before conftest's autouse stub replaces it.
REAL_CALL_GROQ_FEEDBACK = llm._call_groq_feedback
DEFAULT = {"confidence_score": 60, "strong_signals": [], "weak_signals": [], "improvement_tips": []}


def _pdf(text: str) -> bytes:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


# --- generate_deck_feedback ---------------------------------------------------

def test_valid_feedback_is_parsed_clamped_and_truncated(monkeypatch):
    prompts = []
    payload = {
        "confidence_score": 140.6,
        "strong_signals": ["Domain clearly identified as Clean Energy", ""],
        "weak_signals": "Team gaps not mentioned",
        "improvement_tips": ["a", "b", "c", "d"],
    }
    monkeypatch.setattr(llm, "_call_groq_feedback", lambda prompt: prompts.append(prompt) or json.dumps(payload))

    feedback = llm.generate_deck_feedback(PROFILE)

    assert feedback.confidence_score == 100
    assert feedback.strong_signals == ["Domain clearly identified as Clean Energy"]
    assert feedback.weak_signals == ["Team gaps not mentioned"]
    assert feedback.improvement_tips == ["a", "b", "c"]
    # The spec's prompt, carrying the extracted profile as JSON.
    assert json.dumps(PROFILE.model_dump()) in prompts[0]
    assert "confidence_score: how well a mentor could assess fit" in prompts[0]


def test_negative_and_string_scores_are_clamped(monkeypatch):
    monkeypatch.setattr(llm, "_call_groq_feedback", lambda _: '{"confidence_score": -5}')
    assert llm.generate_deck_feedback(PROFILE).confidence_score == 0
    monkeypatch.setattr(llm, "_call_groq_feedback", lambda _: '{"confidence_score": "72"}')
    assert llm.generate_deck_feedback(PROFILE).confidence_score == 72


def test_markdown_fenced_json_is_accepted(monkeypatch):
    monkeypatch.setattr(llm, "_call_groq_feedback", lambda _: '```json\n{"confidence_score": 81}\n```')
    assert llm.generate_deck_feedback(PROFILE).confidence_score == 81


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        "[1, 2, 3]",
        '{"strong_signals": ["missing score"]}',
        '{"confidence_score": "very high"}',
        '{"confidence_score": true}',
        '{"confidence_score": 70, "strong_signals": 5}',
    ],
)
def test_malformed_feedback_falls_back_to_default(monkeypatch, raw):
    monkeypatch.setattr(llm, "_call_groq_feedback", lambda _: raw)
    assert llm.generate_deck_feedback(PROFILE).model_dump() == DEFAULT


def test_groq_failure_falls_back_to_default(monkeypatch, caplog):
    def boom(_):
        raise HTTPException(status_code=502, detail="down")

    monkeypatch.setattr(llm, "_call_groq_feedback", boom)
    with caplog.at_level("WARNING"):
        assert llm.generate_deck_feedback(PROFILE).model_dump() == DEFAULT
    assert any("Deck feedback unavailable" in record.message for record in caplog.records)


def test_missing_api_key_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(llm, "_call_groq_feedback", REAL_CALL_GROQ_FEEDBACK)
    monkeypatch.setattr(llm.settings, "GROQ_API_KEY", "")
    assert llm.generate_deck_feedback(PROFILE).model_dump() == DEFAULT


def test_feedback_call_uses_json_mode(monkeypatch):
    captured = {}

    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    captured.update(kwargs)

                    class Message:
                        content = '{"confidence_score": 90}'

                    class Choice:
                        message = Message()

                    class Completion:
                        choices = [Choice()]

                    return Completion()

    monkeypatch.setattr(llm, "_call_groq_feedback", REAL_CALL_GROQ_FEEDBACK)
    monkeypatch.setattr(llm, "_get_client", lambda: FakeClient())
    assert llm.generate_deck_feedback(PROFILE).confidence_score == 90
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["messages"][-1]["content"] == llm.build_feedback_prompt(PROFILE)


def test_deck_feedback_default_shape():
    assert DeckFeedback.default().model_dump() == DEFAULT


# --- /extract -------------------------------------------------------------------

@pytest.fixture
def stub_extraction(monkeypatch):
    from app.routers import extract as extract_router

    monkeypatch.setattr(
        extract_router,
        "extract_startup_profile",
        lambda text: StartupProfile(domain="Fintech", stage="MVP", challenges=["Runway"], team_gaps=["No CTO"]),
    )


def _extract(client):
    token = register(client, STARTUP_PAYLOAD)
    return client.post(
        "/extract",
        files={"file": ("deck.pdf", _pdf(DECK_TEXT), "application/pdf")},
        headers=auth_header(token),
    )


def test_extract_includes_deck_feedback(client, monkeypatch, stub_extraction):
    monkeypatch.setattr(
        llm,
        "_call_groq_feedback",
        lambda _: json.dumps(
            {
                "confidence_score": 85,
                "strong_signals": ["Domain clear"],
                "weak_signals": ["Geography missing"],
                "improvement_tips": ["Add traction numbers"],
            }
        ),
    )
    response = _extract(client)
    assert response.status_code == 200, response.text
    body = response.json()
    # Existing fields unchanged.
    assert body["domain"] == "Fintech"
    assert body["stage"] == "MVP"
    assert body["challenges"] == ["Runway"]
    assert body["team_gaps"] == ["No CTO"]
    assert "geography" in body
    assert body["deck_feedback"] == {
        "confidence_score": 85,
        "strong_signals": ["Domain clear"],
        "weak_signals": ["Geography missing"],
        "improvement_tips": ["Add traction numbers"],
    }


def test_extract_never_fails_because_of_feedback(client, stub_extraction):
    # conftest's autouse fixture makes the feedback call raise.
    response = _extract(client)
    assert response.status_code == 200, response.text
    assert response.json()["deck_feedback"] == DEFAULT
