"""
Organizations, cohorts and invites (tenancy, Phase 1).

GET    /orgs/me                         (JWT) caller's org + their cohorts
POST   /cohorts/{cohort_id}/invites     (JWT; coordinator of that cohort)
GET    /cohorts/{cohort_id}/invites     (JWT; coordinator of that cohort)
DELETE /invites/{invite_id}             (JWT; coordinator of the invite's cohort) revoke
GET    /invites/{token}                 (public) preview: org / cohort / role, no secrets

Invites are redeemed by POST /register with `invite_token` (app/routers/auth.py).
"""
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from app.db.mongo import (
    get_cohorts_collection,
    get_invites_collection,
    get_mentors_collection,
    get_organizations_collection,
)
from app.models.schemas import (
    CohortOut,
    InviteCreateRequest,
    InviteCreateResponse,
    InviteListResponse,
    InviteOut,
    InvitePreviewResponse,
    MyOrgResponse,
    OrgOut,
)
from app.services.auth_dependency import Principal, get_principal
from app.services.tenancy import (
    create_invite,
    find_usable_invite,
    invite_out,
    invite_url,
    iso,
    object_id,
    utcnow,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["orgs"])

_DB_ERROR = "Could not load organization data. Please try again shortly."


def _require_coordinator_of(principal: Principal, cohort_id: str) -> Dict[str, Any]:
    """Return the cohort doc if the caller coordinates it, else 403/404."""
    if not principal.is_coordinator:
        raise HTTPException(status_code=403, detail="Only coordinator accounts can manage invites.")
    if str(cohort_id) not in principal.cohort_ids:
        # Same answer for "not yours" and "doesn't exist": no cohort probing.
        raise HTTPException(status_code=403, detail="You do not coordinate this cohort.")
    oid = object_id(cohort_id)
    try:
        cohort = get_cohorts_collection().find_one({"_id": oid}) if oid else None
    except Exception:
        logger.exception("Failed to load cohort %s", cohort_id)
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    if not cohort:
        raise HTTPException(status_code=404, detail="Cohort not found.")
    return cohort


@router.get("/orgs/me", response_model=MyOrgResponse)
async def my_org(principal: Principal = Depends(get_principal)) -> MyOrgResponse:
    """The caller's organization and the cohorts they belong to."""
    try:
        org = get_organizations_collection().find_one({"_id": object_id(principal.org_id)})
        cohort_oids = [oid for oid in (object_id(cid) for cid in principal.cohort_ids) if oid]
        cohorts = list(get_cohorts_collection().find({"_id": {"$in": cohort_oids}})) if cohort_oids else []
    except Exception:
        logger.exception("Failed to load org for %s", principal.user_id)
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    order = {cid: i for i, cid in enumerate(principal.cohort_ids)}
    cohorts.sort(key=lambda c: order.get(str(c["_id"]), len(order)))
    return MyOrgResponse(
        org=OrgOut(
            org_id=str(org["_id"]), slug=org.get("slug", ""), name=org.get("name", ""), timezone=org.get("timezone")
        ),
        cohorts=[
            CohortOut(cohort_id=str(c["_id"]), name=c.get("name", ""), status=c.get("status") or "active")
            for c in cohorts
        ],
    )


@router.post("/cohorts/{cohort_id}/invites", response_model=InviteCreateResponse, status_code=201)
async def create_cohort_invite(
    cohort_id: str, request: InviteCreateRequest, principal: Principal = Depends(get_principal)
) -> InviteCreateResponse:
    """Create an invite into one of the caller's cohorts.

    The raw token (and the /join link) is returned only here; the database
    keeps its sha256.
    """
    cohort = _require_coordinator_of(principal, cohort_id)

    if request.mentor_id:
        oid = object_id(request.mentor_id)
        try:
            mentor = get_mentors_collection().find_one({"_id": oid}, {"user_id": 1}) if oid else None
        except Exception:
            logger.exception("Failed to load mentor %s", request.mentor_id)
            raise HTTPException(status_code=502, detail=_DB_ERROR)
        if not mentor:
            raise HTTPException(status_code=404, detail="Mentor not found.")
        if mentor.get("user_id"):
            raise HTTPException(status_code=409, detail="This mentor profile has already been claimed.")

    try:
        token, doc = create_invite(
            org_id=str(cohort["org_id"]),
            cohort_id=str(cohort["_id"]),
            role=request.role,
            email=request.email,
            mentor_id=request.mentor_id,
            max_uses=request.max_uses,
            expires_in_days=request.expires_in_days,
            created_by=principal.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("Failed to create invite for cohort %s", cohort_id)
        raise HTTPException(status_code=502, detail="Could not create the invite. Please try again shortly.")

    return InviteCreateResponse(**invite_out(doc), token=token, url=invite_url(token))


@router.get("/cohorts/{cohort_id}/invites", response_model=InviteListResponse)
async def list_cohort_invites(cohort_id: str, principal: Principal = Depends(get_principal)) -> InviteListResponse:
    """Every invite of one of the caller's cohorts, newest first."""
    _require_coordinator_of(principal, cohort_id)
    try:
        docs: List[Dict[str, Any]] = list(
            get_invites_collection().find({"cohort_id": str(cohort_id)}, {"token_hash": 0}).sort("created_at", -1)
        )
    except Exception:
        logger.exception("Failed to list invites for cohort %s", cohort_id)
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    return InviteListResponse(invites=[InviteOut(**invite_out(doc)) for doc in docs])


@router.delete("/invites/{invite_id}", response_model=InviteOut)
async def revoke_invite(invite_id: str, principal: Principal = Depends(get_principal)) -> InviteOut:
    """Revoke an invite (idempotent). Already-registered users are unaffected."""
    if not principal.is_coordinator:
        raise HTTPException(status_code=403, detail="Only coordinator accounts can manage invites.")
    oid = object_id(invite_id)
    try:
        invite = get_invites_collection().find_one({"_id": oid}, {"token_hash": 0}) if oid else None
    except Exception:
        logger.exception("Failed to load invite %s", invite_id)
        raise HTTPException(status_code=502, detail=_DB_ERROR)
    if not invite or str(invite.get("cohort_id")) not in principal.cohort_ids:
        raise HTTPException(status_code=404, detail="Invite not found.")

    if not invite.get("revoked_at"):
        now = utcnow()
        try:
            get_invites_collection().update_one(
                {"_id": oid, "revoked_at": None}, {"$set": {"revoked_at": now, "revoked_by": principal.user_id}}
            )
        except Exception:
            logger.exception("Failed to revoke invite %s", invite_id)
            raise HTTPException(status_code=502, detail="Could not revoke the invite. Please try again shortly.")
        invite["revoked_at"] = now
    return InviteOut(**invite_out(invite))


@router.get("/invites/{token}", response_model=InvitePreviewResponse)
async def preview_invite(token: str) -> InvitePreviewResponse:
    """Public preview of an invite for the /join page (404 unknown, 410 unusable)."""
    invite = find_usable_invite(token)
    try:
        org = get_organizations_collection().find_one({"_id": object_id(invite.get("org_id"))})
        cohort = get_cohorts_collection().find_one({"_id": object_id(invite.get("cohort_id"))})
        mentor = None
        if invite.get("mentor_id"):
            mentor = get_mentors_collection().find_one({"_id": object_id(invite["mentor_id"])}, {"name": 1})
    except Exception:
        logger.exception("Failed to load invite context")
        raise HTTPException(status_code=502, detail="Could not load the invite. Please try again shortly.")
    if not org or not cohort:
        raise HTTPException(status_code=404, detail="Invite not found.")
    return InvitePreviewResponse(
        org_name=org.get("name", ""),
        org_slug=org.get("slug", ""),
        cohort_name=cohort.get("name", ""),
        role=invite["role"],
        email=invite.get("email"),
        mentor_name=(mentor or {}).get("name"),
        expires_at=iso(invite.get("expires_at")),
    )
