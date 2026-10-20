"""
FastAPI dependencies for authentication.

* `get_current_user` extracts and validates the bearer JWT from the
  Authorization header and returns its payload (`sub`, `role`).
* `get_principal` additionally loads the caller's user document on every
  request, so role and tenancy (org / cohorts) come from the database
  rather than from a token that may predate a role change (e.g. a
  coordinator demoted by scripts/migrate_v2.py). Users that predate
  tenancy fall back to the `legacy` org's default cohort. JWTs are
  unchanged.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import jwt
from fastapi import Depends, Header, HTTPException

from app.db.mongo import get_users_collection
from app.services.auth import decode_access_token
from app.services.tenancy import ensure_legacy_org, object_id

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(default=None)) -> Dict[str, Any]:
    """Parse `Authorization: Bearer <token>`, validate it, and return the
    decoded JWT payload (contains `sub` = user_id and `role`).

    Raises HTTPException(401) on a missing, malformed, invalid, or expired token.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization header must be 'Bearer <token>'.")

    token = parts[1]
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Access token has expired.")
    except jwt.PyJWTError as exc:
        logger.warning("Invalid access token: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid access token.")

    return payload


@dataclass
class Principal:
    """The authenticated caller, as stored in the database."""

    user_id: str
    role: str
    email: str
    org_id: str
    cohort_id: Optional[str]
    cohort_ids: List[str] = field(default_factory=list)
    mentor_id: Optional[str] = None
    # True when the user doc had no org yet and the legacy org was assumed.
    legacy_fallback: bool = False

    @property
    def is_coordinator(self) -> bool:
        return self.role == "coordinator"


def principal_from_doc(doc: Dict[str, Any]) -> Principal:
    org_id = doc.get("org_id")
    cohort_id = doc.get("cohort_id")
    cohort_ids = [str(cid) for cid in (doc.get("cohort_ids") or []) if cid]
    legacy = False
    if not org_id:
        org_id, legacy_cohort_id = ensure_legacy_org()
        cohort_id = cohort_id or legacy_cohort_id
        legacy = True
    if cohort_id and str(cohort_id) not in cohort_ids:
        cohort_ids.insert(0, str(cohort_id))
    return Principal(
        user_id=str(doc["_id"]),
        role=doc.get("role") or "startup",
        email=doc.get("email") or "",
        org_id=str(org_id),
        cohort_id=str(cohort_id) if cohort_id else None,
        cohort_ids=cohort_ids,
        mentor_id=str(doc["mentor_id"]) if doc.get("mentor_id") else None,
        legacy_fallback=legacy,
    )


async def get_principal(user: Dict[str, Any] = Depends(get_current_user)) -> Principal:
    """Load the caller's user document (401 if the account is gone)."""
    oid = object_id(user.get("sub"))
    if oid is None:
        raise HTTPException(status_code=401, detail="Invalid access token.")
    try:
        doc = get_users_collection().find_one(
            {"_id": oid},
            {"email": 1, "role": 1, "org_id": 1, "cohort_id": 1, "cohort_ids": 1, "mentor_id": 1},
        )
    except Exception:
        logger.exception("Failed to load principal %s", oid)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=401, detail="User account no longer exists.")
    try:
        return principal_from_doc(doc)
    except Exception:
        logger.exception("Failed to resolve tenancy for %s", oid)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")
