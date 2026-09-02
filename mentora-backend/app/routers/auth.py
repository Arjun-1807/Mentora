"""
POST /register, POST /login, GET /me - user registration, authentication
and identity.

Registering as a mentor also inserts a matching document into the
`mentors` collection (with an embedding) so the new mentor is immediately
discoverable via /match's Atlas Vector Search. The mentor document is
inserted *first* and rolled back if the user insert fails, so the two
never drift apart (previously a failed mentor insert left an orphaned
user account behind).
"""
import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from app.db.mongo import get_mentors_collection, get_users_collection
from app.models.schemas import (
    LoginRequest,
    MeResponse,
    MentorProfileIn,
    RegisterRequest,
    TokenResponse,
)
from app.services.auth import create_access_token, hash_password, verify_password
from app.services.auth_dependency import get_current_user
from app.services.embeddings import build_mentor_profile_text, embed_passage
from app.services.rate_limit import rate_limit_login

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


def _validate_mentor_profile(profile: dict) -> MentorProfileIn:
    """Validate the mentor registration profile, raising a clear 422.

    Without this, a mentor could register with no domain/stage_focus/
    expertise, get a meaningless embedding, and pollute match results.
    """
    try:
        return MentorProfileIn.model_validate(profile or {})
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or 'profile'}: {error['msg']}"
            for error in exc.errors()
        )
        raise HTTPException(
            status_code=422,
            detail=(
                "Mentor registration requires a valid profile with 'name', 'domain', "
                "'stage_focus' (one of: idea, MVP, growth) and a non-empty 'expertise' "
                f"list. Problems: {problems}"
            ),
        ) from exc


def _insert_mentor_document(mentor_profile: MentorProfileIn) -> ObjectId:
    """Insert the mentor document (with embedding) and return its _id."""
    text = build_mentor_profile_text(
        domain=mentor_profile.domain,
        stage_focus=mentor_profile.stage_focus,
        expertise=mentor_profile.expertise,
    )
    embedding = embed_passage(text)

    mentor_doc = {
        "name": mentor_profile.name,
        "domain": mentor_profile.domain,
        "stage_focus": mentor_profile.stage_focus,
        "expertise": mentor_profile.expertise,
        "sector_expertise": mentor_profile.sector_expertise,
        "past_exits": mentor_profile.past_exits,
        "geography": mentor_profile.geography,
        "availability": mentor_profile.availability,
        "embedding": embedding,
        "effectiveness_score": None,
        "feedback_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return get_mentors_collection().insert_one(mentor_doc).inserted_id


def _rollback_mentor(mentor_object_id: Optional[ObjectId]) -> None:
    """Best-effort removal of a mentor document after a failed registration."""
    if mentor_object_id is None:
        return
    try:
        get_mentors_collection().delete_one({"_id": mentor_object_id})
    except Exception:
        logger.exception("Failed to roll back mentor document %s", mentor_object_id)


@router.post("/register", response_model=TokenResponse)
async def register(request: RegisterRequest) -> TokenResponse:
    """Register a new user (startup or mentor). Mentors are also inserted
    into the `mentors` collection so they're immediately matchable, and
    the two documents are cross-linked via `users.mentor_id`."""
    users = get_users_collection()

    mentor_profile: Optional[MentorProfileIn] = None
    if request.role == "mentor":
        mentor_profile = _validate_mentor_profile(request.profile)

    # Hash before touching the database so a rejected password (too short /
    # over bcrypt's 72-byte limit) never creates partial state.
    password_hash = hash_password(request.password)

    # Cheap pre-check for a friendly error; the unique index on
    # users.email is what actually makes this race-free.
    if users.find_one({"email": request.email}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    mentor_object_id: Optional[ObjectId] = None
    if mentor_profile is not None:
        try:
            mentor_object_id = _insert_mentor_document(mentor_profile)
        except Exception as exc:
            logger.exception("Failed to insert mentor document for %s", request.email)
            raise HTTPException(
                status_code=502,
                detail="Could not index your mentor profile for matching. Please try again shortly.",
            ) from exc

    user_doc = {
        "email": request.email,
        "password_hash": password_hash,
        "role": request.role,
        "profile": mentor_profile.model_dump() if mentor_profile is not None else request.profile,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if mentor_object_id is not None:
        user_doc["mentor_id"] = str(mentor_object_id)

    try:
        result = users.insert_one(user_doc)
    except DuplicateKeyError as exc:
        _rollback_mentor(mentor_object_id)
        raise HTTPException(status_code=400, detail="An account with this email already exists.") from exc
    except Exception as exc:
        _rollback_mentor(mentor_object_id)
        logger.exception("Failed to insert user document for %s", request.email)
        raise HTTPException(
            status_code=502, detail="Could not create your account. Please try again shortly."
        ) from exc

    user_id = str(result.inserted_id)

    # Link back from the mentor document to the owning user account.
    if mentor_object_id is not None:
        try:
            get_mentors_collection().update_one(
                {"_id": mentor_object_id}, {"$set": {"user_id": user_id}}
            )
        except Exception:
            logger.exception("Failed to link mentor %s to user %s", mentor_object_id, user_id)

    token = create_access_token(user_id=user_id, role=request.role)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, _: None = Depends(rate_limit_login)) -> TokenResponse:
    """Authenticate a user by email/password and return a JWT access token.

    Rate-limited per client IP to slow down password brute-forcing.
    """
    users = get_users_collection()
    user = users.find_one({"email": request.email})

    if not user or not verify_password(request.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(user_id=str(user["_id"]), role=user.get("role", ""))
    return TokenResponse(access_token=token)


def _user_object_id(user_id: str) -> Tuple[Optional[ObjectId], bool]:
    try:
        return ObjectId(user_id), True
    except (InvalidId, TypeError):
        return None, False


@router.get("/me", response_model=MeResponse)
async def me(user=Depends(get_current_user)) -> MeResponse:
    """Return the authenticated user's own record, without the password hash."""
    user_id = str(user.get("sub", ""))
    object_id, ok = _user_object_id(user_id)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid access token.")

    try:
        doc = get_users_collection().find_one({"_id": object_id}, {"password_hash": 0})
    except Exception:
        logger.exception("Failed to load user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")

    if not doc:
        raise HTTPException(status_code=404, detail="User account no longer exists.")

    return MeResponse(
        user_id=str(doc["_id"]),
        email=doc.get("email", ""),
        role=doc.get("role", "startup"),
        profile=doc.get("profile") or {},
        mentor_id=doc.get("mentor_id"),
        created_at=doc.get("created_at"),
    )
