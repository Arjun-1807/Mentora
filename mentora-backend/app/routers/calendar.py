"""
Google Calendar integration endpoints.

GET  /calendar/auth-url          (JWT)         -> {auth_url}
POST /calendar/callback          (no auth)     {code, state} -> {success, role}
GET  /calendar/status            (JWT)         -> {connected}
POST /calendar/slots             (JWT, mentor) {slots:[{day,start_time,end_time}]} -> {slots}
GET  /calendar/slots/{mentor_id} (no auth)     -> {slots}
POST /calendar/book              (JWT, startup) -> {success, event_id, meet_link, html_link, title, start, end}

OAuth state: /auth-url stores a random one-time `state` (plus the PKCE
code_verifier google-auth-oauthlib generated) in `oauth_states`; the
callback consumes it atomically (find_one_and_delete) and rejects states
older than OAUTH_STATE_TTL_SECONDS (a TTL index also purges them).

Booking: the event is created on the startup's primary calendar with both
the startup and the mentor as attendees (so it lands on both calendars,
with invitations sent), plus a Google Meet conference. Both parties must
have connected Google Calendar, otherwise 403
`{"error": "calendar_not_connected", "user": "startup"|"mentor", "detail": ...}`.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.db.mongo import (
    get_matches_collection,
    get_mentors_collection,
    get_oauth_states_collection,
    get_users_collection,
)
from app.models.schemas import (
    WEEKDAYS,
    AvailabilitySlot,
    AvailabilitySlotsRequest,
    AvailabilitySlotsResponse,
    BookingRequest,
    BookingResponse,
    CalendarAuthUrlResponse,
    CalendarCallbackRequest,
    CalendarCallbackResponse,
    CalendarStatusResponse,
)
from app.services import google_calendar as gcal
from app.services import matches as match_service
from app.services.auth_dependency import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["calendar"])

BOOKABLE_STATUSES = ("accepted", "meeting_scheduled")
CALENDAR_NOT_CONNECTED = "calendar_not_connected"


# --- helpers -------------------------------------------------------------------

def _object_id(raw: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def _load_user(user_id: str) -> Dict[str, Any]:
    object_id = _object_id(user_id)
    if object_id is None:
        raise HTTPException(status_code=401, detail="Invalid access token.")
    try:
        doc = get_users_collection().find_one({"_id": object_id}, {"password_hash": 0})
    except Exception:
        logger.exception("Failed to load user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load your account. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="User account no longer exists.")
    return doc


def _load_mentor(mentor_id: str) -> Dict[str, Any]:
    object_id = _object_id(mentor_id)
    if object_id is None:
        raise HTTPException(status_code=404, detail="Mentor not found.")
    try:
        doc = get_mentors_collection().find_one({"_id": object_id}, {"embedding": 0})
    except Exception:
        logger.exception("Failed to load mentor %s", mentor_id)
        raise HTTPException(status_code=502, detail="Could not load the mentor. Please try again shortly.")
    if not doc:
        raise HTTPException(status_code=404, detail="Mentor not found.")
    return doc


def _calendar_not_connected(who: str, detail: str) -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={"error": CALENDAR_NOT_CONNECTED, "user": who, "detail": detail},
    )


def _google_error(exc: gcal.GoogleCalendarError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _as_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _calendar_zone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.CALENDAR_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        logger.error("Invalid CALENDAR_TIMEZONE %r; falling back to UTC", settings.CALENDAR_TIMEZONE)
        return ZoneInfo("UTC")


def _normalise_slots(slots: List[AvailabilitySlot]) -> List[Dict[str, str]]:
    """De-duplicate and sort weekly slots (Monday first, then start time)."""
    unique: Dict[tuple, Dict[str, str]] = {}
    for slot in slots:
        key = (slot.day, slot.start_time, slot.end_time)
        unique.setdefault(key, {"day": slot.day, "start_time": slot.start_time, "end_time": slot.end_time})
    return sorted(unique.values(), key=lambda s: (WEEKDAYS.index(s["day"]), s["start_time"], s["end_time"]))


def _stored_slots(mentor_doc: Dict[str, Any]) -> List[Dict[str, str]]:
    """Return a mentor's stored slots, skipping any malformed legacy entries."""
    valid: List[AvailabilitySlot] = []
    for raw in mentor_doc.get("availability_slots") or []:
        try:
            valid.append(AvailabilitySlot.model_validate(raw))
        except Exception:
            continue
    return _normalise_slots(valid)


def _persist_tokens(user_doc: Dict[str, Any], tokens: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc)
    updates = {f"google_calendar.{key}": value for key, value in tokens.items() if value is not None}
    updates["google_calendar.updated_at"] = now
    try:
        get_users_collection().update_one({"_id": user_doc["_id"]}, {"$set": updates})
    except Exception:
        # The refreshed token is still usable for this request.
        logger.exception("Failed to persist refreshed Google tokens for user %s", user_doc.get("_id"))


# --- OAuth -------------------------------------------------------------------------

@router.get("/calendar/auth-url", response_model=CalendarAuthUrlResponse)
async def calendar_auth_url(user=Depends(get_current_user)) -> CalendarAuthUrlResponse:
    """Build the Google consent-screen URL for the signed-in user."""
    gcal.require_configured()
    user_doc = _load_user(str(user.get("sub", "")))

    state = secrets.token_urlsafe(32)
    try:
        auth_url, code_verifier = gcal.build_authorization_url(state)
    except Exception:
        logger.exception("Failed to build the Google authorization URL")
        raise HTTPException(status_code=502, detail="Could not start the Google Calendar connection.")

    try:
        get_oauth_states_collection().insert_one(
            {
                "state": state,
                "user_id": str(user_doc["_id"]),
                "role": user_doc.get("role"),
                "code_verifier": code_verifier,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        logger.exception("Failed to store OAuth state")
        raise HTTPException(status_code=502, detail="Could not start the Google Calendar connection.")

    return CalendarAuthUrlResponse(auth_url=auth_url)


@router.post("/calendar/callback", response_model=CalendarCallbackResponse)
async def calendar_callback(request: CalendarCallbackRequest) -> CalendarCallbackResponse:
    """Finish the OAuth flow: validate + consume `state`, exchange `code`
    for tokens and store them on the user who started the flow."""
    gcal.require_configured()

    try:
        state_doc = get_oauth_states_collection().find_one_and_delete({"state": request.state})
    except Exception:
        logger.exception("Failed to look up OAuth state")
        raise HTTPException(status_code=502, detail="Could not finish connecting your calendar.")

    if not state_doc:
        raise HTTPException(
            status_code=400,
            detail="This calendar connection link is invalid or was already used. Please try connecting again.",
        )

    created_at = _as_utc(state_doc.get("created_at"))
    max_age = timedelta(seconds=settings.OAUTH_STATE_TTL_SECONDS)
    if created_at is None or datetime.now(timezone.utc) - created_at > max_age:
        raise HTTPException(
            status_code=400, detail="This calendar connection link has expired. Please try connecting again."
        )

    user_doc = _load_user(str(state_doc.get("user_id") or ""))

    try:
        tokens = gcal.exchange_code(request.code, state_doc.get("code_verifier"))
    except gcal.GoogleCalendarError as exc:
        raise _google_error(exc) from exc

    now = datetime.now(timezone.utc)
    updates = {f"google_calendar.{key}": value for key, value in tokens.items() if value is not None}
    updates["google_calendar.updated_at"] = now
    updates["google_calendar.connected_at"] = now
    try:
        get_users_collection().update_one({"_id": user_doc["_id"]}, {"$set": updates})
    except Exception:
        logger.exception("Failed to store Google tokens for user %s", user_doc["_id"])
        raise HTTPException(status_code=502, detail="Could not save your calendar connection. Please try again.")

    return CalendarCallbackResponse(success=True, role=user_doc.get("role"))


@router.get("/calendar/status", response_model=CalendarStatusResponse)
async def calendar_status(user=Depends(get_current_user)) -> CalendarStatusResponse:
    user_doc = _load_user(str(user.get("sub", "")))
    return CalendarStatusResponse(connected=gcal.has_calendar_tokens(user_doc))


# --- availability slots ------------------------------------------------------------

@router.post("/calendar/slots", response_model=AvailabilitySlotsResponse)
async def save_availability_slots(
    request: AvailabilitySlotsRequest, user=Depends(get_current_user)
) -> AvailabilitySlotsResponse:
    """Replace the signed-in mentor's weekly availability slots."""
    if user.get("role") != "mentor":
        raise HTTPException(status_code=403, detail="Only mentor accounts can set availability.")

    user_doc = _load_user(str(user.get("sub", "")))
    mentor_object_id = _object_id(user_doc.get("mentor_id"))
    if mentor_object_id is None:
        raise HTTPException(status_code=404, detail="No mentor profile is linked to this account.")

    slots = _normalise_slots(request.slots)
    try:
        result = get_mentors_collection().update_one(
            {"_id": mentor_object_id},
            {
                "$set": {
                    "availability_slots": slots,
                    "availability_updated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
    except Exception:
        logger.exception("Failed to save availability for mentor %s", mentor_object_id)
        raise HTTPException(status_code=502, detail="Could not save your availability. Please try again shortly.")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No mentor profile is linked to this account.")

    return AvailabilitySlotsResponse(slots=slots)


@router.get("/calendar/slots/{mentor_id}", response_model=AvailabilitySlotsResponse)
async def get_availability_slots(mentor_id: str) -> AvailabilitySlotsResponse:
    """Public: a mentor's weekly recurring availability (mentors-collection _id)."""
    return AvailabilitySlotsResponse(slots=_stored_slots(_load_mentor(mentor_id)))


# --- booking ---------------------------------------------------------------------------

def _within_availability(slot, weekday: str, mentor_slots: List[Dict[str, str]]) -> bool:
    return any(
        s["day"] == weekday and s["start_time"] <= slot.start_time and slot.end_time <= s["end_time"]
        for s in mentor_slots
    )


def _mentor_user_doc(mentor_id: str, mentor_doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    users = get_users_collection()
    try:
        doc = users.find_one({"mentor_id": mentor_id}, {"password_hash": 0})
        if doc is None and mentor_doc.get("user_id"):
            linked = _object_id(mentor_doc["user_id"])
            if linked is not None:
                doc = users.find_one({"_id": linked}, {"password_hash": 0})
    except Exception:
        logger.exception("Failed to load the user account of mentor %s", mentor_id)
        raise HTTPException(status_code=502, detail="Could not load the mentor. Please try again shortly.")
    return doc


@router.post("/calendar/book", response_model=BookingResponse)
async def book_meeting(request: BookingRequest, user=Depends(get_current_user)) -> BookingResponse:
    """Book a Google Meet meeting with the mentor of one of the caller's
    accepted matches and mark the match `meeting_scheduled`.

    Errors: 403 non-startup / not your match / calendar_not_connected,
    404 unknown match or mentor, 400 mentor_id not on the match, 409 match
    not accepted or slot outside the mentor's availability, 422 bad body or
    a slot in the past, 502 Google API failure, 503 calendar not configured.
    """
    if user.get("role") != "startup":
        raise HTTPException(status_code=403, detail="Only startup accounts can book meetings.")
    gcal.require_configured()

    user_id = str(user.get("sub", ""))
    matches = get_matches_collection()
    try:
        match_doc = matches.find_one({"match_id": request.match_id})
    except Exception:
        logger.exception("Failed to look up match %s", request.match_id)
        raise HTTPException(status_code=502, detail="Could not load the match. Please try again shortly.")
    if not match_doc:
        raise HTTPException(status_code=404, detail="Match not found.")
    if str(match_doc.get("user_id") or "") != user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this match.")
    if str(match_doc.get("mentor_id") or "") != request.mentor_id:
        raise HTTPException(status_code=400, detail="mentor_id does not correspond to the mentor on this match.")
    current_status = match_service.normalise_status(match_doc.get("status"))
    if current_status not in BOOKABLE_STATUSES:
        raise HTTPException(
            status_code=409, detail="A meeting can only be booked once the mentor has accepted the match."
        )

    mentor_doc = _load_mentor(request.mentor_id)

    zone = _calendar_zone()
    slot = request.slot
    start = datetime.fromisoformat(f"{slot.date}T{slot.start_time}").replace(tzinfo=zone)
    end = datetime.fromisoformat(f"{slot.date}T{slot.end_time}").replace(tzinfo=zone)
    if start <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="That time slot is in the past. Please pick a future slot.")

    mentor_slots = _stored_slots(mentor_doc)
    if mentor_slots and not _within_availability(slot, WEEKDAYS[start.weekday()], mentor_slots):
        raise HTTPException(status_code=409, detail="That time is outside the mentor's availability.")

    startup_doc = _load_user(user_id)
    if not gcal.has_calendar_tokens(startup_doc):
        raise _calendar_not_connected("startup", "Connect your Google Calendar before booking a meeting.")

    mentor_user = _mentor_user_doc(request.mentor_id, mentor_doc)
    if not gcal.has_calendar_tokens(mentor_user):
        raise _calendar_not_connected("mentor", "This mentor hasn't connected their Google Calendar yet.")

    try:
        tokens, refreshed = gcal.ensure_fresh_tokens(gcal.get_calendar_tokens(startup_doc))
    except gcal.CalendarAuthError as exc:
        raise _calendar_not_connected(
            "startup", "Your Google Calendar connection has expired. Please reconnect it."
        ) from exc
    except gcal.GoogleCalendarError as exc:
        raise _google_error(exc) from exc
    if refreshed:
        _persist_tokens(startup_doc, tokens)

    profile = match_doc.get("startup_profile") or {}
    domain = profile.get("domain") or "Startup"
    mentor_name = mentor_doc.get("name") or match_doc.get("mentor_name") or "Mentor"
    title = f"Mentora: {domain} × {mentor_name}"
    description = (request.description or "").strip()
    description = f"{description}\n\nBooked via Mentora." if description else "Intro mentorship meeting booked via Mentora."

    mentor_email = mentor_doc.get("email") or (mentor_user or {}).get("email")
    attendees = [email for email in (startup_doc.get("email"), mentor_email) if email]

    try:
        event = gcal.create_meet_event(
            tokens,
            summary=title,
            description=description,
            start=start,
            end=end,
            time_zone=str(zone.key),
            attendees=attendees,
        )
    except gcal.CalendarAuthError as exc:
        raise _calendar_not_connected(
            "startup", "Your Google Calendar connection has expired. Please reconnect it."
        ) from exc
    except gcal.GoogleCalendarError as exc:
        raise _google_error(exc) from exc

    meeting = {
        "date": slot.date,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "event_id": event.get("event_id"),
        "meet_link": event.get("meet_link"),
        "html_link": event.get("html_link"),
        "title": title,
    }
    now = datetime.now(timezone.utc).isoformat()
    try:
        if current_status == match_service.ACCEPTED:
            match_service.transition_match(
                match_doc["match_id"],
                match_service.STARTUP,
                user_id,
                match_service.MEETING_SCHEDULED,
                {"meeting": meeting},
                doc=match_doc,
            )
        else:
            # Re-booking an already scheduled meeting only replaces the meeting
            # (reschedule / cancel proper arrives with Phase 3).
            matches.update_one({"_id": match_doc["_id"]}, {"$set": {"meeting": meeting, "updated_at": now}})
    except Exception:
        # The event exists on both calendars; don't hide that from the user.
        logger.exception("Meeting booked but failed to update match %s", request.match_id)

    return BookingResponse(
        success=True,
        event_id=meeting["event_id"] or "",
        meet_link=meeting["meet_link"],
        html_link=meeting["html_link"],
        title=title,
        start=start.isoformat(),
        end=end.isoformat(),
    )
