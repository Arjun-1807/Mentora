"""
PDF text extraction using PyMuPDF (fitz).
"""
import pymupdf as fitz  # PyMuPDF (the `pymupdf` import path avoids the deprecated `fitz` package warning)

from fastapi import HTTPException, UploadFile


ALLOWED_CONTENT_TYPES = {"application/pdf"}


async def extract_text_from_pdf(file: UploadFile) -> str:
    """Read an uploaded PDF file and return its concatenated text content.

    Raises HTTPException for non-PDF uploads, empty files, or files that
    cannot be parsed / contain no extractable text.
    """
    filename = file.filename or ""
    content_type = (file.content_type or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES and not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{content_type or 'unknown'}'. Please upload a PDF file.",
        )

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        document = fitz.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises generic exceptions for corrupt files
        raise HTTPException(status_code=400, detail=f"Could not read PDF file: {exc}") from exc

    try:
        pages_text = [page.get_text() for page in document]
    finally:
        document.close()

    text = "\n".join(pages_text).strip()

    if not text:
        raise HTTPException(
            status_code=422,
            detail="No extractable text found in the PDF (it may be scanned/image-only).",
        )

    return text
