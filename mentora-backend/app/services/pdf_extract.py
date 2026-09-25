"""
PDF text extraction using PyMuPDF (fitz).

Uploads are size-capped (settings.MAX_UPLOAD_BYTES, 10 MB by default) and
read in chunks so an oversized file is rejected with 413 before the whole
thing is buffered in memory (and before its text is shipped to Groq).
"""
import logging

import pymupdf as fitz  # PyMuPDF (the `pymupdf` import path avoids the deprecated `fitz` package warning)

from fastapi import HTTPException, UploadFile

from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {"application/pdf"}

# Decks yielding less text than this are treated as image-based/empty:
# there is not enough content for the LLM to extract a meaningful profile.
MIN_EXTRACTED_CHARS = 100

NOT_PDF_MESSAGE = "Only PDF files are accepted"
TOO_LITTLE_TEXT_MESSAGE = "Deck appears to be image-based or empty. Please upload a text-based PDF."

# Size of each chunk read from the upload stream.
_CHUNK_SIZE = 64 * 1024


async def _read_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read the upload stream, aborting with 413 once max_bytes is exceeded."""
    chunks = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Uploaded file is too large. The maximum accepted size is "
                    f"{max_bytes // (1024 * 1024)} MB."
                ),
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def extract_text_from_pdf(file: UploadFile) -> str:
    """Read an uploaded PDF file and return its concatenated text content.

    Raises HTTPException for non-PDF uploads (400), empty files (400),
    oversized files (413), unparseable files (400), or files with fewer
    than MIN_EXTRACTED_CHARS characters of extractable text (422, e.g.
    scanned, image-only decks).
    """
    filename = file.filename or ""
    content_type = (file.content_type or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES and not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail=NOT_PDF_MESSAGE)

    raw_bytes = await _read_capped(file, settings.MAX_UPLOAD_BYTES)
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        document = fitz.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises generic exceptions for corrupt files
        logger.warning("Rejected unreadable PDF upload %r: %s", filename, exc)
        raise HTTPException(
            status_code=400,
            detail="Could not read the uploaded file as a PDF. It may be corrupt or password-protected.",
        ) from exc

    try:
        pages_text = [page.get_text() for page in document]
        page_count = document.page_count
    finally:
        document.close()

    text = "\n".join(pages_text).strip()

    if len(text) < MIN_EXTRACTED_CHARS:
        logger.info(
            "Rejected PDF %r: only %d extractable character(s) across %d page(s)",
            filename,
            len(text),
            page_count,
        )
        raise HTTPException(status_code=422, detail=TOO_LITTLE_TEXT_MESSAGE)

    return text
