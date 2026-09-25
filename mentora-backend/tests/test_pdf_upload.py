"""Tests for PDF upload validation on /extract (size cap, type, OCR case)."""
import pymupdf
import pytest

from app.config import settings
from app.models.schemas import StartupProfile
from tests.conftest import DECK_TEXT, STARTUP_PAYLOAD, auth_header, register


@pytest.fixture
def token(client):
    return register(client, STARTUP_PAYLOAD)


@pytest.fixture(autouse=True)
def no_groq(monkeypatch):
    from app.routers import extract as extract_router

    monkeypatch.setattr(
        extract_router,
        "extract_startup_profile",
        lambda text: StartupProfile(domain="Fintech", stage="MVP", challenges=["Runway"]),
    )


def _pdf(text: str = "") -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    if text:
        page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def test_extract_requires_authentication(client):
    response = client.post("/extract", files={"file": ("deck.pdf", _pdf("hello world"), "application/pdf")})
    assert response.status_code == 401


def test_extract_accepts_a_text_pdf(client, token):
    response = client.post(
        "/extract",
        files={"file": ("deck.pdf", _pdf(DECK_TEXT), "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert response.json()["domain"] == "Fintech"


def test_extract_rejects_oversized_upload_with_413(client, token):
    oversized = b"%PDF-1.4\n" + b"0" * (settings.MAX_UPLOAD_BYTES + 1)
    response = client.post(
        "/extract",
        files={"file": ("huge.pdf", oversized, "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_extract_accepts_upload_just_under_the_cap(client, token, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_BYTES", 200_000)
    payload = _pdf(DECK_TEXT)
    assert len(payload) < 200_000
    response = client.post(
        "/extract",
        files={"file": ("deck.pdf", payload, "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 200


def test_extract_rejects_non_pdf(client, token):
    response = client.post(
        "/extract",
        files={"file": ("notes.txt", b"just some text", "text/plain")},
        headers=auth_header(token),
    )
    assert response.status_code == 400
    assert response.json()["error"] == "Only PDF files are accepted"
    assert response.json()["detail"] == "Only PDF files are accepted"


def test_extract_rejects_empty_file(client, token):
    response = client.post(
        "/extract",
        files={"file": ("deck.pdf", b"", "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_extract_rejects_corrupt_pdf_without_leaking_internals(client, token):
    response = client.post(
        "/extract",
        files={"file": ("deck.pdf", b"not really a pdf at all", "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 400
    assert "corrupt" in response.json()["detail"].lower()


IMAGE_BASED_MESSAGE = "Deck appears to be image-based or empty. Please upload a text-based PDF."


def test_extract_rejects_image_only_pdf_with_actionable_message(client, token):
    """A scanned/image-only deck yields no text and must say so clearly."""
    response = client.post(
        "/extract",
        files={"file": ("scan.pdf", _pdf(), "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 422
    assert response.json()["error"] == IMAGE_BASED_MESSAGE


def test_extract_rejects_pdf_with_under_100_chars_of_text(client, token):
    response = client.post(
        "/extract",
        files={"file": ("thin.pdf", _pdf("Acme, a Fintech startup at MVP stage."), "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 422
    assert response.json()["error"] == IMAGE_BASED_MESSAGE


@pytest.mark.parametrize("second_line, expected", [(49, 200), (48, 422)])
def test_extract_minimum_text_boundary_is_100_chars(client, token, second_line, expected):
    # Two short lines (long single lines get clipped at the page edge):
    # 50 + newline + 49 == 100 extracted characters.
    text = "\n".join(["x" * 50, "y" * second_line])
    response = client.post(
        "/extract",
        files={"file": ("deck.pdf", _pdf(text), "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == expected
