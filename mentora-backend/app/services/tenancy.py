"""
Tenancy: organizations, cohorts and invites.

Data model
----------
organizations  {slug, name, timezone, created_at}
cohorts        {org_id, name, status, coordinator_user_ids, created_at}
invites        {token_hash, org_id, cohort_id, role, email?, mentor_id?,
                max_uses, uses, expires_at, revoked_at, created_by,
                created_at, redeemed_by[]}
users          gain org_id, cohort_id (primary) and cohort_ids.

Invite tokens are random 256-bit url-safe strings handed out exactly once
(in the /join/<token> link). Only their sha256 is stored, so a database
leak does not leak usable invites. Redeeming is a single atomic
`find_one_and_update` that re-checks revocation, expiry and the use count,
so two concurrent registrations cannot both consume a single-use invite.

Users that predate tenancy (or register without an invite) belong to the
`legacy` org's `default` cohort; `ensure_legacy_org()` creates both lazily.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.config import settings
from app.db.mongo import (
    get_cohorts_collection,
    get_invites_collection,
    get_organizations_collection,
)

logger = logging.getLogger(__name__)

LEGACY_ORG_SLUG = "legacy"
LEGACY_ORG_NAME = "Legacy (pre-tenancy users)"
DEFAULT_COHORT_NAME = "default"

EMAIL_BOUND_ROLES = ("mentor", "coordinator")


def default_mentor_flags(org_ids: Optional[list] = None) -> Dict[str, Any]:
    """Visibility/listing defaults for a mentor document.

    Mentors stay one shared global pool: `visibility.scope` is "global"
    (every org can be matched with them) or "orgs" (only `org_ids`).
    `org_ids` also records which orgs invited the mentor. `listed` and
    `active` are filters for matching (applied in Phase 4).
    """
    return {
        "visibility": {"scope": "global", "org_ids": [str(o) for o in (org_ids or [])]},
        "listed": True,
        "active": True,
    }


# --- small helpers ---------------------------------------------------------------

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: Any) -> Optional[datetime]:
    """Stored datetimes come back naive (UTC) from pymongo/mongomock."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return None


def iso(value: Any) -> Optional[str]:
    parsed = as_utc(value)
    return parsed.isoformat() if parsed else None


def object_id(raw: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def invite_url(token: str, base_url: Optional[str] = None) -> str:
    return f"{(base_url or settings.FRONTEND_ORIGIN).rstrip('/')}/join/{token}"


def normalise_email(email: Optional[str]) -> Optional[str]:
    return email.strip().lower() if isinstance(email, str) and email.strip() else None


# --- orgs and cohorts ----------------------------------------------------------------

def _upsert_one(collection, query: Dict[str, Any], on_insert: Dict[str, Any]) -> Dict[str, Any]:
    """Get-or-create, safe against a concurrent creator (unique index)."""
    for _ in range(2):
        try:
            return collection.find_one_and_update(
                query,
                {"$setOnInsert": {**query, **on_insert}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            continue
    doc = collection.find_one(query)
    if doc is None:  # pragma: no cover - only on a pathological race
        raise RuntimeError(f"Could not get or create {collection.name} {query}")
    return doc


def get_or_create_org(slug: str, name: str, tz: str = "Asia/Kolkata") -> Dict[str, Any]:
    return _upsert_one(
        get_organizations_collection(),
        {"slug": slug},
        {"name": name, "timezone": tz, "created_at": utcnow()},
    )


def get_or_create_cohort(org_id: str, name: str) -> Dict[str, Any]:
    return _upsert_one(
        get_cohorts_collection(),
        {"org_id": str(org_id), "name": name},
        {"status": "active", "coordinator_user_ids": [], "created_at": utcnow()},
    )


def ensure_legacy_org() -> Tuple[str, str]:
    """Return (org_id, cohort_id) of the legacy org / default cohort."""
    org = get_or_create_org(LEGACY_ORG_SLUG, LEGACY_ORG_NAME)
    cohort = get_or_create_cohort(str(org["_id"]), DEFAULT_COHORT_NAME)
    return str(org["_id"]), str(cohort["_id"])


def add_coordinator_to_cohort(cohort_id: str, user_id: str) -> None:
    oid = object_id(cohort_id)
    if oid is not None:
        get_cohorts_collection().update_one(
            {"_id": oid}, {"$addToSet": {"coordinator_user_ids": str(user_id)}}
        )


# --- invites --------------------------------------------------------------------------

def invite_status(invite: Dict[str, Any], now: Optional[datetime] = None) -> str:
    now = now or utcnow()
    if invite.get("revoked_at"):
        return "revoked"
    if int(invite.get("uses") or 0) >= int(invite.get("max_uses") or 1):
        return "used"
    expires_at = as_utc(invite.get("expires_at"))
    if expires_at is not None and expires_at <= now:
        return "expired"
    return "active"


def create_invite(
    *,
    org_id: str,
    cohort_id: str,
    role: str,
    email: Optional[str] = None,
    mentor_id: Optional[str] = None,
    max_uses: Optional[int] = None,
    expires_in_days: Optional[int] = None,
    created_by: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Insert an invite and return (raw_token, invite_doc).

    Coordinator and mentor invites are always single-use and email-bound;
    startup links default to `INVITE_LINK_DEFAULT_MAX_USES` uses.
    """
    email = normalise_email(email)
    if role in EMAIL_BOUND_ROLES:
        if not email:
            raise ValueError(f"{role} invites must be bound to an email address")
        max_uses = 1
        days = expires_in_days or settings.INVITE_EMAIL_TTL_DAYS
    else:
        max_uses = max_uses or (1 if email else settings.INVITE_LINK_DEFAULT_MAX_USES)
        days = expires_in_days or settings.INVITE_LINK_TTL_DAYS

    token = generate_token()
    now = utcnow()
    doc = {
        "token_hash": hash_token(token),
        "org_id": str(org_id),
        "cohort_id": str(cohort_id),
        "role": role,
        "email": email,
        "mentor_id": str(mentor_id) if mentor_id else None,
        "max_uses": int(max_uses),
        "uses": 0,
        "expires_at": now + timedelta(days=days),
        "revoked_at": None,
        "created_by": created_by,
        "created_at": now,
        "redeemed_by": [],
    }
    doc["_id"] = get_invites_collection().insert_one(doc).inserted_id
    return token, doc


_UNUSABLE_MESSAGES = {
    "revoked": "This invite has been revoked.",
    "used": "This invite has already been used.",
    "expired": "This invite has expired.",
}


def find_usable_invite(token: str) -> Dict[str, Any]:
    """Look an invite up by its raw token; 404 if unknown, 410 if unusable."""
    if not token or not isinstance(token, str):
        raise HTTPException(status_code=404, detail="Invite not found.")
    try:
        invite = get_invites_collection().find_one({"token_hash": hash_token(token)})
    except Exception:
        logger.exception("Failed to look up invite")
        raise HTTPException(status_code=502, detail="Could not load the invite. Please try again shortly.")
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found.")
    status = invite_status(invite)
    if status != "active":
        raise HTTPException(status_code=410, detail=_UNUSABLE_MESSAGES[status])
    return invite


def consume_invite(invite: Dict[str, Any]) -> Dict[str, Any]:
    """Atomically take one use of `invite`, or 410 if it became unusable.

    `max_uses` never changes after creation, so comparing `uses` against the
    value read earlier inside the same atomic filter is race-free.
    """
    now = utcnow()
    updated = get_invites_collection().find_one_and_update(
        {
            "_id": invite["_id"],
            "revoked_at": None,
            "expires_at": {"$gt": now},
            "uses": {"$lt": int(invite.get("max_uses") or 1)},
        },
        {"$inc": {"uses": 1}, "$set": {"last_used_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        fresh = get_invites_collection().find_one({"_id": invite["_id"]}) or invite
        status = invite_status(fresh, now)
        raise HTTPException(
            status_code=410, detail=_UNUSABLE_MESSAGES.get(status, "This invite can no longer be used.")
        )
    return updated


def release_invite(invite: Dict[str, Any]) -> None:
    """Give a use back after the registration it was taken for failed."""
    try:
        get_invites_collection().update_one(
            {"_id": invite["_id"], "uses": {"$gt": 0}}, {"$inc": {"uses": -1}}
        )
    except Exception:
        logger.exception("Failed to release invite %s", invite.get("_id"))


def record_redemption(invite: Dict[str, Any], user_id: str, email: str) -> None:
    try:
        get_invites_collection().update_one(
            {"_id": invite["_id"]},
            {"$push": {"redeemed_by": {"user_id": user_id, "email": email, "at": utcnow()}}},
        )
    except Exception:
        logger.exception("Failed to record redemption of invite %s", invite.get("_id"))


def invite_out(invite: Dict[str, Any]) -> Dict[str, Any]:
    """The coordinator-facing view of an invite (no token hash)."""
    return {
        "invite_id": str(invite["_id"]),
        "org_id": str(invite.get("org_id") or ""),
        "cohort_id": str(invite.get("cohort_id") or ""),
        "role": invite.get("role"),
        "email": invite.get("email"),
        "mentor_id": invite.get("mentor_id"),
        "max_uses": int(invite.get("max_uses") or 1),
        "uses": int(invite.get("uses") or 0),
        "expires_at": iso(invite.get("expires_at")),
        "revoked_at": iso(invite.get("revoked_at")),
        "created_at": iso(invite.get("created_at")),
        "status": invite_status(invite),
    }


def cohort_member_query(cohort_ids) -> Dict[str, Any]:
    """Mongo filter for users that belong to any of `cohort_ids`.

    Users that predate tenancy (no `org_id` yet, i.e. before migrate_v2.py
    ran) count as members of the legacy default cohort.
    """
    ids = [str(cid) for cid in cohort_ids or [] if cid]
    clauses: list = [{"cohort_ids": {"$in": ids}}, {"cohort_id": {"$in": ids}}]
    _, legacy_cohort_id = ensure_legacy_org()
    if legacy_cohort_id in ids:
        clauses.append({"org_id": {"$exists": False}})
    return {"$or": clauses}


def user_in_cohorts(user_doc: Dict[str, Any], cohort_ids) -> bool:
    """Python-side twin of `cohort_member_query` for a single user doc."""
    ids = {str(cid) for cid in cohort_ids or [] if cid}
    if not ids:
        return False
    member_of = {str(cid) for cid in (user_doc.get("cohort_ids") or [])}
    if user_doc.get("cohort_id"):
        member_of.add(str(user_doc["cohort_id"]))
    if member_of & ids:
        return True
    if "org_id" not in user_doc:
        _, legacy_cohort_id = ensure_legacy_org()
        return legacy_cohort_id in ids
    return False
