"""
POST /match                      - top mentor matches for the caller's active profile
GET  /matches                    - the startup's matches (server-side source of truth)
POST /matches/{match_id}/request - send the intro email -> `requested`
POST /matches/{match_id}/withdraw - take back a pending request -> `withdrawn`
POST /matches/all                - legacy listing (startup: own; mentor: requested+)
GET  /mentors                    - mentor directory (never includes embeddings)

See app/services/matches.py for match identity and the lifecycle.
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.db.mongo import get_matches_collection, get_mentors_collection, get_users_collection
from app.models.schemas import (
    MatchRequestIn,
    MatchResponse,
    MentorListItem,
    MentorListResponse,
    StartupProfile,
)
from app.routers.startup import require_startup
from app.services import matches as match_service
from app.services import startups as startup_service
from app.services.auth_dependency import Principal, get_current_user, get_principal
from app.services.mailer import MailError, frontend_url, send_mail
from app.services.mentor_matching import ensure_mentors_exist, find_matching_mentors
from app.services.rate_limit import rate_limit_match_request_for_user
from app.services.tenancy import object_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["match"])

_LIST_ERROR = "Could not load your matches. Please try again shortly."
REQUEST_LOCK_SECONDS = 120


def _profile_from_body(body: Optional[Dict[str, Any]]) -> Optional[StartupProfile]:
    """A legacy client still posts the full profile; an empty body means
    "use my active profile"."""
    if not body:
        return None
    try:
        return StartupProfile.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid startup profile: {exc}") from exc


@router.post("/match", response_model=MatchResponse)
async def match_mentors(
    body: Optional[Dict[str, Any]] = Body(default=None),
    principal: Principal = Depends(get_principal),
) -> MatchResponse:
    """Rank the top 5 mentors for the caller's active startup profile and
    record them as `suggested` matches.

    Matches are keyed on (startup, mentor): a mentor already matched keeps
    its match (and status) with a refreshed score; suggestions that fell out
    of the top 5 become `superseded`. Mentors that declined, expired or were
    withdrawn are not suggested again.

    For backward compatibility a full StartupProfile body is accepted; if it
    differs from the active profile it is saved as a new version first.
    """
    posted = _profile_from_body(body)
    ensure_mentors_exist()

    if principal.role != "startup":
        # Non-startup accounts can still preview a ranking; nothing is recorded.
        if posted is None:
            raise HTTPException(status_code=422, detail="Provide a startup profile to match.")
        return MatchResponse(matches=find_matching_mentors(posted))

    startup = require_startup(principal)
    profile_doc = startup_service.get_active_profile(startup)
    if posted is not None:
        current = StartupProfile.model_validate(profile_doc["profile"]) if profile_doc else None
        if current is None or match_service.profile_fingerprint(current) != match_service.profile_fingerprint(posted):
            profile_doc = startup_service.save_profile_version(
                startup, posted.model_dump(), source=startup_service.SOURCE_MATCH_REQUEST,
                created_by=principal.user_id,
                deck_feedback=(profile_doc or {}).get("deck_feedback"),
                deck_filename=(profile_doc or {}).get("deck_filename"),
            )
    if profile_doc is None:
        raise HTTPException(status_code=409, detail="Upload a pitch deck first so we know what to match on.")
    profile = StartupProfile.model_validate(profile_doc["profile"])

    exclude = match_service.terminal_mentor_ids(str(startup["_id"]))
    ranked = find_matching_mentors(profile, exclude_mentor_ids=exclude) if exclude else find_matching_mentors(profile)
    try:
        match_service.sync_matches(startup, profile_doc, profile, ranked)
    except Exception:
        logger.exception("Failed to record matches for startup %s", startup["_id"])
        raise HTTPException(status_code=502, detail="Could not save your matches. Please try again shortly.")
    return MatchResponse(matches=ranked)


def _startup_matches(principal: Principal) -> List[Dict[str, Any]]:
    scope = {"user_id": principal.user_id}
    match_service.expire_stale_requests(scope)
    docs = [
        match_service.jsonable(doc)
        for doc in get_matches_collection().find({**scope, **match_service.VISIBLE_FILTER}).sort("timestamp", -1)
    ]
    return match_service.enrich_match_docs(docs, include_mentor_details=True)


@router.get("/matches")
async def list_matches(principal: Principal = Depends(get_principal)) -> dict:
    """The startup's matches, newest first: everything except superseded
    suggestions (declined / withdrawn / expired ones are kept for history).
    Each item carries the mentor card fields (name, domain, expertise, email,
    match_score), `status`, `meeting`, `replacement_for(_name)` and `history`.
    Stale requests are expired first (lazily)."""
    if principal.role != "startup":
        raise HTTPException(status_code=403, detail="Only startup accounts have mentor matches.")
    require_startup(principal)  # adopts legacy match docs on first use
    try:
        return {"matches": _startup_matches(principal)}
    except Exception:
        logger.exception("Failed to list matches for %s", principal.user_id)
        raise HTTPException(status_code=502, detail=_LIST_ERROR)


def _own_match(principal: Principal, match_id: str) -> Dict[str, Any]:
    if principal.role != "startup":
        raise HTTPException(status_code=403, detail="Only startup accounts can do this.")
    try:
        doc = match_service.find_match(match_id)
    except Exception:
        logger.exception("Failed to load match %s", match_id)
        raise HTTPException(status_code=502, detail="Could not load the match. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="Match not found.")
    if str(doc.get("user_id") or "") != principal.user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this match.")
    return doc


def _mentor_contact(mentor_id: str) -> Dict[str, Any]:
    oid = object_id(mentor_id)
    mentor = get_mentors_collection().find_one({"_id": oid}, {"name": 1, "email": 1, "user_id": 1}) if oid else None
    if not mentor:
        raise HTTPException(status_code=404, detail="This mentor no longer exists.")
    email = mentor.get("email")
    if not email and mentor.get("user_id"):
        user = get_users_collection().find_one({"_id": object_id(mentor["user_id"])}, {"email": 1})
        email = (user or {}).get("email")
    if not email:
        raise HTTPException(status_code=409, detail="We don't have an email address for this mentor yet.")
    return {"name": mentor.get("name") or "Mentor", "email": email}


def _match_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = match_service.enrich_match_docs([match_service.jsonable(doc)], include_mentor_details=True)[0]
    out.pop("request_lock", None)
    return out


@router.post("/matches/{match_id}/request")
async def request_intro(
    match_id: str, request: MatchRequestIn, principal: Principal = Depends(get_principal)
) -> dict:
    """Send the (reviewed) intro email to the mentor and mark the match
    `requested`. Startup only, own match, status `suggested`.

    The recipient is the mentor's address from the database, never from the
    client. The founder's email is the Reply-To. Rate-limited per user.
    Errors: 403 not yours / not a startup, 404 unknown, 409 wrong status or
    no mentor email, 429 rate limit, 502 delivery failed (match unchanged).
    """
    if principal.role != "startup":
        raise HTTPException(status_code=403, detail="Only startup accounts can request an intro.")
    rate_limit_match_request_for_user(principal.user_id)
    doc = _own_match(principal, match_id)
    if match_service.normalise_status(doc.get("status")) != match_service.SUGGESTED:
        raise HTTPException(status_code=409, detail="An intro has already been requested for this match.")
    contact = _mentor_contact(str(doc.get("mentor_id") or ""))

    matches = get_matches_collection()
    now = match_service.now_utc()
    lock_cutoff = (now.timestamp() - REQUEST_LOCK_SECONDS)
    claimed = matches.find_one_and_update(
        {
            "_id": doc["_id"],
            "status": doc.get("status"),
            "$or": [{"request_lock": {"$exists": False}}, {"request_lock": {"$lt": lock_cutoff}}],
        },
        {"$set": {"request_lock": now.timestamp()}},
    )
    if claimed is None:
        raise HTTPException(status_code=409, detail="This intro is already being sent.")

    body = (
        f"{request.body}\n\n"
        "--\n"
        "This introduction was sent through Mentora. Accept or decline the request here:\n"
        f"{frontend_url('/mentor/dashboard?tab=requests')}\n"
    )
    try:
        record = send_mail(
            to=contact["email"],
            subject=request.subject,
            body=body,
            reply_to=principal.email or None,
            kind="intro_request",
            match_id=doc.get("match_id"),
        )
    except MailError as exc:
        matches.update_one({"_id": doc["_id"]}, {"$unset": {"request_lock": ""}})
        raise HTTPException(status_code=502, detail="Could not send the email. Please try again shortly.") from exc

    sent_at = match_service.now_utc().isoformat()
    try:
        updated = match_service.transition_match(
            doc["match_id"],
            match_service.STARTUP,
            principal.user_id,
            match_service.REQUESTED,
            {
                "requested_at": sent_at,
                "email_sent_at": sent_at,
                "request": {
                    "subject": request.subject,
                    "body": request.body,
                    "sent_at": sent_at,
                    "delivery": record.get("delivery"),
                    "outbox_id": str(record["_id"]) if record.get("_id") else None,
                },
            },
            doc=claimed,
        )
    except match_service.TransitionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    finally:
        matches.update_one({"_id": doc["_id"]}, {"$unset": {"request_lock": ""}})
    updated.pop("request_lock", None)
    return {"success": True, "delivery": record.get("delivery"), "match": _match_out(updated)}


@router.post("/matches/{match_id}/withdraw")
async def withdraw_request(match_id: str, principal: Principal = Depends(get_principal)) -> dict:
    """Take back a request the mentor hasn't answered (requested -> withdrawn).
    A replacement suggestion is added."""
    doc = _own_match(principal, match_id)
    try:
        updated = match_service.transition_match(
            doc["match_id"], match_service.STARTUP, principal.user_id, match_service.WITHDRAWN, doc=doc
        )
    except match_service.TransitionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return {"success": True, "match": _match_out(updated)}


@router.post("/matches/all")
async def get_all_matches(principal: Principal = Depends(get_principal)) -> dict:
    """Legacy listing (prefer GET /matches / GET /mentor/matches).

    * a startup sees its own matches (superseded suggestions excluded);
    * a mentor sees matches pointing at their mentor record from
      `requested` on only, with the startup's email only once accepted.
    """
    try:
        if principal.role == "mentor":
            if not principal.mentor_id:
                return {"matches": []}
            scope = {"mentor_id": principal.mentor_id}
            match_service.expire_stale_requests(scope)
            docs = list(
                get_matches_collection()
                .find({**scope, "status": match_service.status_in(match_service.REQUESTED_OR_LATER),
                       "duplicate_of": {"$exists": False}})
                .sort("timestamp", -1)
            )
            return {"matches": match_service.mentor_view(docs)}
        scope = {"user_id": principal.user_id}
        match_service.expire_stale_requests(scope)
        docs = [
            match_service.jsonable(doc)
            for doc in get_matches_collection().find({**scope, **match_service.VISIBLE_FILTER}).sort("timestamp", -1)
        ]
    except Exception:
        logger.exception("Failed to list match records for user %s", principal.user_id)
        raise HTTPException(status_code=502, detail="Could not load match history. Please try again shortly.")
    return {"matches": match_service.enrich_match_docs(docs)}


@router.get("/mentors", response_model=MentorListResponse)
async def list_mentors(
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    domain: Optional[str] = Query(default=None, description="Case-insensitive exact domain filter"),
    stage_focus: Optional[str] = Query(default=None, description="Filter by idea/MVP/growth"),
    user=Depends(get_current_user),
) -> MentorListResponse:
    """Mentor directory for a browse view.

    The `embedding` field is explicitly projected out - it is ~768 floats
    per mentor and of no use to clients.
    """
    query: Dict[str, Any] = {}
    if domain:
        query["domain"] = {"$regex": f"^{domain.strip()}$", "$options": "i"}
    if stage_focus:
        query["stage_focus"] = {"$regex": f"^{stage_focus.strip()}$", "$options": "i"}

    projection = {"embedding": 0, "skill_embeddings": 0}

    try:
        collection = get_mentors_collection()
        total = collection.count_documents(query)
        docs = list(collection.find(query, projection).skip(skip).limit(limit))
    except Exception:
        logger.exception("Failed to list mentors")
        raise HTTPException(status_code=502, detail="Could not load mentors. Please try again shortly.")

    mentors: List[MentorListItem] = [
        MentorListItem(
            mentor_id=str(doc.get("_id", "")),
            name=doc.get("name") or "Unknown",
            domain=doc.get("domain") or "Unknown",
            stage_focus=doc.get("stage_focus") or "Unknown",
            expertise=doc.get("expertise") or [],
            geography=doc.get("geography"),
            email=doc.get("email"),
            effectiveness_score=doc.get("effectiveness_score"),
            feedback_count=int(doc.get("feedback_count") or 0),
            claimed=bool(doc.get("user_id")),
        )
        for doc in docs
    ]

    return MentorListResponse(mentors=mentors, total=total)
