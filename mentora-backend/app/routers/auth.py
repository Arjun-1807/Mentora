"""
POST /register, POST /login, GET /me - user registration, authentication
and identity.

Tenancy: `/register` accepts an `invite_token` (see app/services/tenancy.py)
that places the user in the invite's org/cohort. Coordinators can only
register with a coordinator invite (403 otherwise); startups and mentors
without one land in the `legacy` org's default cohort.

Registering as a mentor also inserts a matching document into the
`mentors` collection (with an embedding) so the new mentor is immediately
discoverable via /match's Atlas Vector Search. The mentor document is
inserted *first* and rolled back if the user insert fails, so the two
never drift apart (previously a failed mentor insert left an orphaned
user account behind).
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

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
from app.services.google_calendar import has_calendar_tokens
from app.services.rate_limit import rate_limit_login
from app.services.tenancy import (
    add_coordinator_to_cohort,
    consume_invite,
    default_mentor_flags,
    ensure_legacy_org,
    find_usable_invite,
    normalise_email,
    object_id,
    record_redemption,
    release_invite,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

DUPLICATE_ACCOUNT_MESSAGE = "Account already exists."


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
                "Mentor registration requires a profile with a 'name' and a non-empty "
                "'sector_expertise' list ('stage_focus', if given, must be one of: idea, "
                f"MVP, growth, all). Problems: {problems}"
            ),
        ) from exc


def _insert_mentor_document(
    mentor_profile: MentorProfileIn, email: str, user_id: str, org_id: Optional[str] = None
) -> ObjectId:
    """Insert the mentor document (with embedding) and return its _id.

    `email` is the registering user's address, stored so startups can
    contact the mentor once matched. The rest of the profile is filled in
    by the onboarding flow (PATCH /mentor/profile). `user_id` is the
    (pre-allocated) id of the owning user account.
    """
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
        "preferred_stages": mentor_profile.preferred_stages,
        "past_exits": mentor_profile.past_exits,
        "geography": mentor_profile.geography,
        "availability": mentor_profile.availability,
        "linkedin_url": mentor_profile.linkedin_url,
        "bio": mentor_profile.bio,
        "years_experience": mentor_profile.years_experience,
        "max_startups_per_month": mentor_profile.max_startups_per_month,
        "email": email,
        "user_id": user_id,
        "onboarding_completed": False,
        "embedding": embedding,
        "effectiveness_score": None,
        "feedback_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **default_mentor_flags([org_id] if org_id else None),
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


def _claimable_mentor(mentor_id: str) -> Dict[str, Any]:
    """The seeded mentor document a mentor invite points at (409 if taken)."""
    oid = object_id(mentor_id)
    doc = get_mentors_collection().find_one({"_id": oid}, {"embedding": 0}) if oid else None
    if not doc:
        raise HTTPException(status_code=404, detail="The mentor profile this invite refers to no longer exists.")
    if doc.get("user_id"):
        raise HTTPException(status_code=409, detail="This mentor profile has already been claimed.")
    return doc


def _claim_mentor(mentor_doc: Dict[str, Any], email: str, user_id: str, org_id: str) -> None:
    """Atomically link an unclaimed mentor document to the new user."""
    update: Dict[str, Any] = {
        "$set": {"user_id": user_id, "email": email, "claimed_at": datetime.now(timezone.utc).isoformat()}
    }
    defaults = default_mentor_flags([org_id])
    for key in ("listed", "active"):
        if key not in mentor_doc:
            update["$set"][key] = defaults[key]
    if isinstance(mentor_doc.get("visibility"), dict):
        update["$addToSet"] = {"visibility.org_ids": org_id}
    else:
        update["$set"]["visibility"] = defaults["visibility"]
    claimed = get_mentors_collection().find_one_and_update(
        {"_id": mentor_doc["_id"], "user_id": {"$exists": False}}, update
    )
    if claimed is None:
        raise HTTPException(status_code=409, detail="This mentor profile has already been claimed.")


def _unclaim_mentor(mentor_doc: Optional[Dict[str, Any]], user_id: str) -> None:
    if mentor_doc is None:
        return
    try:
        restore: Dict[str, Any] = {"$unset": {"user_id": "", "claimed_at": ""}}
        if mentor_doc.get("email"):
            restore["$set"] = {"email": mentor_doc["email"]}
        get_mentors_collection().update_one({"_id": mentor_doc["_id"], "user_id": user_id}, restore)
    except Exception:
        logger.exception("Failed to roll back mentor claim %s", mentor_doc.get("_id"))


def _claimed_profile(mentor_doc: Dict[str, Any]) -> Dict[str, Any]:
    """User-side profile copy for an account that claimed a seeded mentor."""
    keys = (
        "name", "domain", "stage_focus", "expertise", "sector_expertise", "preferred_stages",
        "geography", "availability", "linkedin_url", "bio", "years_experience",
        "max_startups_per_month",
    )
    return {key: mentor_doc[key] for key in keys if mentor_doc.get(key) is not None}


def _resolve_invite(request: RegisterRequest) -> Optional[Dict[str, Any]]:
    """Validate `invite_token` against the registration (no writes).

    Coordinators can only register through a coordinator invite.
    """
    if not request.invite_token:
        if request.role == "coordinator":
            raise HTTPException(
                status_code=403,
                detail="Coordinator accounts are invite-only. Ask your incubator for an invite link.",
            )
        return None

    invite = find_usable_invite(request.invite_token)
    if invite.get("role") != request.role:
        raise HTTPException(
            status_code=400, detail=f"This invite is for a {invite.get('role')} account, not {request.role}."
        )
    bound_email = invite.get("email")
    if bound_email and normalise_email(request.email) != bound_email:
        raise HTTPException(status_code=403, detail="This invite was issued for a different email address.")
    return invite


@router.post("/register", response_model=TokenResponse)
async def register(request: RegisterRequest) -> TokenResponse:
    """Register a new user.

    * With `invite_token`, the user joins the invite's org/cohort. A mentor
      invite carrying a `mentor_id` claims that existing (seeded) mentor
      document instead of creating a new one.
    * Without one, startups and mentors land in the `legacy` org's default
      cohort; coordinators are rejected with 403 (invite-only).

    New mentors are inserted into the `mentors` collection (with an
    embedding) so they're immediately matchable; the two documents are
    cross-linked via `users.mentor_id` / `mentors.user_id`.
    """
    users = get_users_collection()

    invite = _resolve_invite(request)
    claim_doc: Optional[Dict[str, Any]] = None
    mentor_profile: Optional[MentorProfileIn] = None
    if request.role == "mentor":
        if invite and invite.get("mentor_id"):
            claim_doc = _claimable_mentor(invite["mentor_id"])
        else:
            mentor_profile = _validate_mentor_profile(request.profile)

    # Hash before touching the database so a rejected password (too short /
    # over bcrypt's 72-byte limit) never creates partial state.
    password_hash = hash_password(request.password)

    # Cheap pre-check for a friendly error; the unique index on
    # users.email is what actually makes this race-free.
    if users.find_one({"email": request.email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=DUPLICATE_ACCOUNT_MESSAGE)

    if invite:
        org_id, cohort_id = str(invite["org_id"]), str(invite["cohort_id"])
    else:
        org_id, cohort_id = ensure_legacy_org()

    # The user _id is allocated up front so the mentor document can point
    # at it before the user document exists.
    user_object_id = ObjectId()
    user_id = str(user_object_id)

    if invite:
        invite = consume_invite(invite)

    mentor_object_id: Optional[ObjectId] = None
    created_mentor = False
    try:
        if claim_doc is not None:
            _claim_mentor(claim_doc, request.email, user_id, org_id)
            mentor_object_id = claim_doc["_id"]
        elif mentor_profile is not None:
            try:
                mentor_object_id = _insert_mentor_document(mentor_profile, request.email, user_id, org_id)
                created_mentor = True
            except Exception as exc:
                logger.exception("Failed to insert mentor document for %s", request.email)
                raise HTTPException(
                    status_code=502,
                    detail="Could not index your mentor profile for matching. Please try again shortly.",
                ) from exc
    except Exception:
        if invite:
            release_invite(invite)
        raise

    if claim_doc is not None:
        profile = _claimed_profile(claim_doc)
    elif mentor_profile is not None:
        profile = mentor_profile.model_dump()
    else:
        profile = request.profile

    user_doc = {
        "_id": user_object_id,
        "email": request.email,
        "password_hash": password_hash,
        "role": request.role,
        "profile": profile,
        "org_id": org_id,
        "cohort_id": cohort_id,
        "cohort_ids": [cohort_id],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if invite:
        user_doc["invite_id"] = str(invite["_id"])
    if mentor_object_id is not None:
        user_doc["mentor_id"] = str(mentor_object_id)

    def _undo() -> None:
        if created_mentor:
            _rollback_mentor(mentor_object_id)
        _unclaim_mentor(claim_doc, user_id)
        if invite:
            release_invite(invite)

    try:
        users.insert_one(user_doc)
    except DuplicateKeyError as exc:
        _undo()
        raise HTTPException(status_code=409, detail=DUPLICATE_ACCOUNT_MESSAGE) from exc
    except Exception as exc:
        _undo()
        logger.exception("Failed to insert user document for %s", request.email)
        raise HTTPException(
            status_code=502, detail="Could not create your account. Please try again shortly."
        ) from exc

    if invite:
        record_redemption(invite, user_id, request.email)
        if request.role == "coordinator":
            add_coordinator_to_cohort(cohort_id, user_id)

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
        calendar_connected=has_calendar_tokens(doc),
        org_id=doc.get("org_id"),
        cohort_id=doc.get("cohort_id"),
        cohort_ids=[str(cid) for cid in (doc.get("cohort_ids") or [])],
    )
