"""
Mentora backend - FastAPI application entrypoint.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager
from typing import Any, List

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.db.mongo import ensure_indexes
from app.routers import auth, email, evaluate, extract, feedback, match, mentor

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Create the MongoDB indexes the app relies on (idempotent)."""
    ensure_indexes()
    yield


app = FastAPI(
    title="Mentora API",
    description="Startup-mentor matching backend: extracts structured startup "
    "profiles from pitch decks and matches them to mentors via vector search.",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# --- Structured error responses -------------------------------------------
# Every error leaves the API as JSON with a human-readable `error` string.
# `detail` is kept alongside it for backward compatibility with existing
# clients. Unhandled exceptions are logged server-side and answered with a
# generic 500 so no traceback or internal detail ever reaches a client.

INTERNAL_ERROR_MESSAGE = "Internal server error."


def _error_message(detail: Any, status_code: int) -> str:
    if isinstance(detail, str) and detail.strip():
        return detail
    if isinstance(detail, dict) and isinstance(detail.get("error"), str):
        return detail["error"]
    return "Request failed." if status_code < 500 else INTERNAL_ERROR_MESSAGE


def _validation_message(errors: List[dict]) -> str:
    parts = []
    for error in errors:
        # Drop the leading "body"/"query" location segment for readability.
        loc = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path")]
        field = ".".join(loc)
        msg = error.get("msg", "Invalid value")
        parts.append(f"{field}: {msg}" if field else msg)
    return "; ".join(parts) or "Invalid request."


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = _error_message(exc.detail, exc.status_code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": message, "detail": message},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    # Never echo submitted values back (e.g. a rejected password), and
    # stringify `ctx`, which may hold the raw exception object, so the
    # payload is always JSON-serialisable.
    safe_errors = jsonable_encoder(
        [{key: value for key, value in error.items() if key != "input"} for error in errors],
        custom_encoder={Exception: str},
    )
    return JSONResponse(
        status_code=422,
        content={"error": _validation_message(errors), "detail": safe_errors},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": INTERNAL_ERROR_MESSAGE, "detail": INTERNAL_ERROR_MESSAGE},
    )


app.include_router(extract.router)
app.include_router(match.router)
app.include_router(email.router)
app.include_router(feedback.router)
app.include_router(auth.router)
app.include_router(mentor.router)
app.include_router(evaluate.router)


@app.get("/", tags=["health"])
async def root() -> dict:
    return {"status": "ok", "service": "mentora-backend"}


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "healthy"}
