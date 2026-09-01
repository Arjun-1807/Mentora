"""
POST /register, POST /login - user registration and authentication.

Registering as a mentor also inserts a matching document into the
`mentors` collection (with an embedding) so the new mentor is immediately
discoverable via /match's Atlas Vector Search.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.db.mongo import get_mentors_collection, get_users_collection
from app.models.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.services.auth import create_access_token, hash_password, verify_password
from app.services.embeddings import build_mentor_profile_text, embed_passage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


def _register_mentor(profile: dict) -> None:
    """Build a mentor profile document (with embedding) from the free-form
    registration profile dict and insert it into the mentors collection."""
    domain = profile.get("domain", "")
    stage_focus = profile.get("stage_focus", "")
    expertise = profile.get("expertise", [])

    text = build_mentor_profile_text(domain=domain, stage_focus=stage_focus, expertise=expertise)
    embedding = embed_passage(text)

    mentor_doc = {
        "name": profile.get("name", ""),
        "domain": domain,
        "stage_focus": stage_focus,
        "expertise": expertise,
        "sector_expertise": profile.get("sector_expertise"),
        "past_exits": profile.get("past_exits"),
        "geography": profile.get("geography"),
        "availability": profile.get("availability"),
        "embedding": embedding,
        "effectiveness_score": None,
    }
    get_mentors_collection().insert_one(mentor_doc)


@router.post("/register", response_model=TokenResponse)
async def register(request: RegisterRequest) -> TokenResponse:
    """Register a new user (startup or mentor). Mentors are also inserted
    into the `mentors` collection so they're immediately matchable."""
    users = get_users_collection()

    if users.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    user_doc = {
        "email": request.email,
        "password_hash": hash_password(request.password),
        "role": request.role,
        "profile": request.profile,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = users.insert_one(user_doc)
    user_id = str(result.inserted_id)

    if request.role == "mentor":
        try:
            _register_mentor(request.profile)
        except Exception:
            logger.exception("Failed to insert mentor document for newly registered mentor %s", request.email)
            raise HTTPException(
                status_code=502,
                detail="Account created but mentor profile could not be indexed for matching. Please contact support.",
            )

    token = create_access_token(user_id=user_id, role=request.role)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    """Authenticate a user by email/password and return a JWT access token."""
    users = get_users_collection()
    user = users.find_one({"email": request.email})

    if not user or not verify_password(request.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(user_id=str(user["_id"]), role=user.get("role", ""))
    return TokenResponse(access_token=token)
