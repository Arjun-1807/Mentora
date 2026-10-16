"""
Server-side startup records and versioned startup profiles.

startups          {org_id, cohort_id, owner_user_id, company_name,
                   active_profile_id, created_at, updated_at}
startup_profiles  {startup_id, version, profile, deck_feedback,
                   deck_filename, source, created_by, created_at}

`profile` is a StartupProfile dict (domain, stage, challenges, team_gaps,
geography). Every POST /extract adds a version (source "deck"); correcting
fields via PATCH /startup/profiles/active adds one with source "manual";
scripts/migrate_v2.py (or the lazy backfill below) adds one with source
"migration" from the user's most recent match snapshot. The startup's
`active_profile_id` always points at the newest version, and POST /match
reads it, so the journey no longer depends on browser storage.

Users that predate this get their startup document lazily, on the first
request that needs it (`ensure_startup`); that also adopts their legacy
match documents (see `services.matches.adopt_legacy_matches`).
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError

from app.config import settings
from app.db.mongo import (
    get_matches_collection,
    get_startup_profiles_collection,
    get_startups_collection,
    get_users_collection,
)
from app.models.schemas import DeckFeedback, StartupProfile

logger = logging.getLogger(__name__)

SOURCE_DECK = "deck"
SOURCE_MANUAL = "manual"
SOURCE_MIGRATION = "migration"
SOURCE_MATCH_REQUEST = "match_request"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _oid(raw: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def _collections(db=None):
    if db is None:
        return get_startups_collection(), get_startup_profiles_collection(), get_matches_collection()
    return (
        db[settings.MONGODB_STARTUPS_COLLECTION],
        db[settings.MONGODB_STARTUP_PROFILES_COLLECTION],
        db[settings.MONGODB_MATCHES_COLLECTION],
    )


def company_name_from_user(user_doc: Dict[str, Any]) -> Optional[str]:
    profile = user_doc.get("profile") or {}
    for key in ("company_name", "company", "startup_name", "name"):
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_startup_by_owner(user_id: str, db=None) -> Optional[Dict[str, Any]]:
    startups, _, _ = _collections(db)
    return startups.find_one({"owner_user_id": str(user_id)})


def get_startup(startup_id: Any, db=None) -> Optional[Dict[str, Any]]:
    startups, _, _ = _collections(db)
    oid = _oid(startup_id)
    return startups.find_one({"_id": oid}) if oid else None


def latest_legacy_profile(user_id: str, db=None) -> Optional[Dict[str, Any]]:
    """The newest valid `startup_profile` snapshot on the user's match docs."""
    _, _, matches = _collections(db)
    for doc in matches.find({"user_id": str(user_id), "startup_profile": {"$type": "object"}}).sort(
        "timestamp", DESCENDING
    ):
        try:
            return StartupProfile.model_validate(doc["startup_profile"]).model_dump()
        except Exception:
            continue
    return None


def ensure_startup(user_doc: Dict[str, Any], *, db=None) -> Dict[str, Any]:
    """Get or create the startup document owned by `user_doc`.

    On creation the user's legacy data is backfilled: a version-1 profile
    from their newest match snapshot (if any) and their match documents are
    adopted (startup_id stamped, statuses mapped, pairs de-duplicated).
    Returns the startup doc with an extra transient key `_created` (bool).
    """
    from app.services.matches import adopt_legacy_matches

    startups, profiles, _ = _collections(db)
    user_id = str(user_doc["_id"])
    existing = startups.find_one({"owner_user_id": user_id})
    if existing is not None:
        existing["_created"] = False
        return existing

    now = _now()
    doc: Dict[str, Any] = {
        "org_id": user_doc.get("org_id"),
        "cohort_id": user_doc.get("cohort_id"),
        "owner_user_id": user_id,
        "company_name": company_name_from_user(user_doc),
        "active_profile_id": None,
        "created_at": now,
        "updated_at": now,
    }
    legacy_profile = latest_legacy_profile(user_id, db)
    try:
        doc["_id"] = startups.insert_one(dict(doc)).inserted_id
    except DuplicateKeyError:
        existing = startups.find_one({"owner_user_id": user_id})
        existing["_created"] = False
        return existing

    if legacy_profile is not None:
        version = save_profile_version(
            doc, legacy_profile, source=SOURCE_MIGRATION, created_by=user_id, db=db
        )
        doc["active_profile_id"] = version["_id"]
    try:
        adopt_legacy_matches(
            user_id,
            str(doc["_id"]),
            org_id=doc.get("org_id"),
            cohort_id=doc.get("cohort_id"),
            profile_id=str(doc["active_profile_id"]) if doc.get("active_profile_id") else None,
            matches=_collections(db)[2],
        )
    except Exception:
        logger.exception("Failed to adopt legacy matches for user %s", user_id)
    doc["_created"] = True
    return doc


def ensure_startup_for_user_id(user_id: str) -> Dict[str, Any]:
    oid = _oid(user_id)
    user_doc = get_users_collection().find_one({"_id": oid}, {"password_hash": 0}) if oid else None
    if not user_doc:
        raise LookupError(f"user {user_id} not found")
    return ensure_startup(user_doc)


def save_profile_version(
    startup: Dict[str, Any],
    profile: Dict[str, Any],
    *,
    source: str,
    created_by: Optional[str] = None,
    deck_feedback: Optional[Dict[str, Any]] = None,
    deck_filename: Optional[str] = None,
    db=None,
) -> Dict[str, Any]:
    """Insert the next profile version and make it the active one."""
    startups, profiles, _ = _collections(db)
    startup_id = str(startup["_id"])
    clean = StartupProfile.model_validate(profile).model_dump()
    for _ in range(5):
        last = profiles.find_one({"startup_id": startup_id}, sort=[("version", DESCENDING)])
        version = int((last or {}).get("version") or 0) + 1
        doc = {
            "startup_id": startup_id,
            "version": version,
            "profile": clean,
            "deck_feedback": deck_feedback,
            "deck_filename": deck_filename,
            "source": source,
            "created_by": created_by,
            "created_at": _now(),
        }
        try:
            doc["_id"] = profiles.insert_one(dict(doc)).inserted_id
            break
        except DuplicateKeyError:
            continue  # a concurrent writer took this version number
    else:  # pragma: no cover - pathological contention
        raise RuntimeError("Could not allocate a profile version")

    startups.update_one(
        {"_id": startup["_id"]},
        {"$set": {"active_profile_id": doc["_id"], "updated_at": _now()}},
    )
    startup["active_profile_id"] = doc["_id"]
    return doc


def get_active_profile(startup: Optional[Dict[str, Any]], db=None) -> Optional[Dict[str, Any]]:
    if not startup:
        return None
    _, profiles, _ = _collections(db)
    oid = _oid(startup.get("active_profile_id"))
    doc = profiles.find_one({"_id": oid}) if oid else None
    if doc is None:
        doc = profiles.find_one({"startup_id": str(startup["_id"])}, sort=[("version", DESCENDING)])
    return doc


def list_profiles(startup: Dict[str, Any], limit: int = 50) -> List[Dict[str, Any]]:
    _, profiles, _ = _collections()
    return list(profiles.find({"startup_id": str(startup["_id"])}).sort("version", DESCENDING).limit(limit))


def profile_version_out(doc: Optional[Dict[str, Any]], active_id: Any = None) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    feedback = doc.get("deck_feedback")
    if isinstance(feedback, dict):
        try:
            feedback = DeckFeedback.model_validate(feedback).model_dump()
        except Exception:
            feedback = None
    created = doc.get("created_at")
    if isinstance(created, datetime):
        created = (created if created.tzinfo else created.replace(tzinfo=timezone.utc)).isoformat()
    return {
        "profile_id": str(doc["_id"]),
        "version": int(doc.get("version") or 0),
        "source": doc.get("source"),
        "profile": doc.get("profile") or {},
        "deck_feedback": feedback,
        "deck_filename": doc.get("deck_filename"),
        "created_at": created,
        "active": active_id is not None and str(active_id) == str(doc["_id"]),
    }


def startup_out(startup: Dict[str, Any], active: Optional[Dict[str, Any]], profile_count: int) -> Dict[str, Any]:
    return {
        "startup_id": str(startup["_id"]),
        "company_name": startup.get("company_name"),
        "org_id": str(startup["org_id"]) if startup.get("org_id") else None,
        "cohort_id": str(startup["cohort_id"]) if startup.get("cohort_id") else None,
        "active_profile": profile_version_out(active, active["_id"] if active else None),
        "profile_count": profile_count,
    }


def company_names(startup_ids) -> Dict[str, Optional[str]]:
    """startup_id -> company_name, one query."""
    oids = [oid for oid in (_oid(s) for s in set(startup_ids or []) if s) if oid]
    if not oids:
        return {}
    try:
        return {
            str(doc["_id"]): doc.get("company_name")
            for doc in get_startups_collection().find({"_id": {"$in": oids}}, {"company_name": 1})
        }
    except Exception:
        logger.exception("Failed to look up company names")
        return {}
