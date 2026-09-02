"""
Mentora backend - FastAPI application entrypoint.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.mongo import ensure_indexes
from app.routers import auth, email, extract, feedback, match

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(extract.router)
app.include_router(match.router)
app.include_router(email.router)
app.include_router(feedback.router)
app.include_router(auth.router)


@app.get("/", tags=["health"])
async def root() -> dict:
    return {"status": "ok", "service": "mentora-backend"}


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "healthy"}
