"""
The startup's server-side record (Phase 2): company name and versioned
profiles, so the journey no longer depends on browser storage.

GET   /startup/me              (JWT, startup) startup + active profile + company_name
GET   /startup/profiles        (JWT, startup) every profile version, newest first
PATCH /startup/me              (JWT, startup) {company_name}
PATCH /startup/profiles/active (JWT, startup) corrected fields -> new version (source "manual")

POST /extract adds a version per uploaded deck; POST /match reads the active one.
"""
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.db.mongo import get_startup_profiles_collection, get_startups_collection, get_users_collection
from app.models.schemas import (
    StartupMeResponse,
    StartupProfilePatch,
    StartupProfilesResponse,
    StartupUpdateRequest,
)
from app.services import startups as startup_service
from app.services.auth_dependency import Principal, get_principal
from app.services.tenancy import object_id, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(tags=["startup"])

_DB_ERROR = "Could not load your startup. Please try again shortly."


def require_startup(principal: Principal) -> Dict[str, Any]:
    """The caller's startup document (created lazily); 403 for other roles."""
    if principal.role != "startup":
        raise HTTPException(status_code=403, detail="Only startup accounts have a startup profile.")
    try:
        user_doc = get_users_collection().find_one({"_id": object_id(principal.user_id)}, {"password_hash": 0})
        if not user_doc:
            raise HTTPException(status_code=401, detail="User account no longer exists.")
        if not user_doc.get("org_id"):
            user_doc = {**user_doc, "org_id": principal.org_id, "cohort_id": principal.cohort_id}
        return startup_service.ensure_startup(user_doc)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to load startup for %s", principal.user_id)
        raise HTTPException(status_code=502, detail=_DB_ERROR)


def _me(startup: Dict[str, Any]) -> StartupMeResponse:
    try:
        active = startup_service.get_active_profile(startup)
        count = get_startup_profiles_collection().count_documents({"startup_id": str(startup["_id"])})
    except Exception:
        logger.exception("Failed to load profiles of startup %s", startup.get("_id"))
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    return StartupMeResponse(**startup_service.startup_out(startup, active, count))


@router.get("/startup/me", response_model=StartupMeResponse)
async def get_my_startup(principal: Principal = Depends(get_principal)) -> StartupMeResponse:
    return _me(require_startup(principal))


@router.patch("/startup/me", response_model=StartupMeResponse)
async def update_my_startup(
    request: StartupUpdateRequest, principal: Principal = Depends(get_principal)
) -> StartupMeResponse:
    startup = require_startup(principal)
    try:
        get_startups_collection().update_one(
            {"_id": startup["_id"]}, {"$set": {"company_name": request.company_name, "updated_at": utcnow()}}
        )
    except Exception:
        logger.exception("Failed to update startup %s", startup["_id"])
        raise HTTPException(status_code=502, detail="Could not save your company name. Please try again shortly.")
    startup["company_name"] = request.company_name
    return _me(startup)


@router.get("/startup/profiles", response_model=StartupProfilesResponse)
async def list_my_profiles(principal: Principal = Depends(get_principal)) -> StartupProfilesResponse:
    startup = require_startup(principal)
    try:
        docs = startup_service.list_profiles(startup)
    except Exception:
        logger.exception("Failed to list profiles of startup %s", startup["_id"])
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    active_id = startup.get("active_profile_id") or (docs[0]["_id"] if docs else None)
    return StartupProfilesResponse(
        profiles=[startup_service.profile_version_out(doc, active_id) for doc in docs]
    )


@router.patch("/startup/profiles/active", response_model=StartupMeResponse)
async def correct_active_profile(
    request: StartupProfilePatch, principal: Principal = Depends(get_principal)
) -> StartupMeResponse:
    """Correct extracted fields. Saves a new version (source "manual") that
    keeps the deck feedback / filename of the version it was based on."""
    startup = require_startup(principal)
    current = startup_service.get_active_profile(startup)
    if current is None:
        raise HTTPException(status_code=409, detail="Upload a pitch deck before editing your profile.")
    merged = {**(current.get("profile") or {}), **request.model_dump(exclude_unset=True)}
    try:
        startup_service.save_profile_version(
            startup,
            merged,
            source=startup_service.SOURCE_MANUAL,
            created_by=principal.user_id,
            deck_feedback=current.get("deck_feedback"),
            deck_filename=current.get("deck_filename"),
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid profile: {exc.errors()[0].get('msg')}") from exc
    except Exception:
        logger.exception("Failed to save corrected profile for startup %s", startup["_id"])
        raise HTTPException(status_code=502, detail="Could not save your profile. Please try again shortly.")
    return _me(startup)
