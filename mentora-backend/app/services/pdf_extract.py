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

    Raises HTTPException for non-PDF uploads, empty files, oversized files
    (413), or files that cannot be parsed / contain no extractable text
    (e.g. scanned, image-only decks).
    """
    filename = file.filename or ""
    content_type = (file.content_type or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES and not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{content_type or 'unknown'}'. Please upload a PDF file.",
        )

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

    if not text:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No extractable text found in this PDF ({page_count} page(s)). It looks "
                "like a scanned or image-only deck. Please upload a text-based PDF "
                "(e.g. exported directly from Keynote/PowerPoint/Google Slides) or run "
                "it through OCR first."
            ),
        )

    return text
