"""Tests for PDF upload validation on /extract (size cap, type, OCR case)."""
import pymupdf
import pytest

from app.config import settings
from app.models.schemas import StartupProfile
from tests.conftest import STARTUP_PAYLOAD, auth_header, register


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
        files={"file": ("deck.pdf", _pdf("Acme, a Fintech startup at MVP stage."), "application/pdf")},
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
    payload = _pdf("Acme, a Fintech startup at MVP stage.")
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
    assert "PDF" in response.json()["detail"]


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


def test_extract_rejects_image_only_pdf_with_actionable_message(client, token):
    """A scanned/image-only deck yields no text and must say so clearly."""
    response = client.post(
        "/extract",
        files={"file": ("scan.pdf", _pdf(), "application/pdf")},
        headers=auth_header(token),
    )
    assert response.status_code == 422
    detail = response.json()["detail"].lower()
    assert "scanned" in detail and "ocr" in detail
