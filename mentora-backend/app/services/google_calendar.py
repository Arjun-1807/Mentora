"""
Google Calendar integration (OAuth 2.0 web flow + event creation).

Token storage: a connected user's document carries

    google_calendar: {
        access_token, refresh_token, token_expiry (UTC datetime),
        scopes: [...], connected_at, updated_at
    }

The Google client libraries are imported lazily inside the functions that
need them, so the rest of the API keeps working (and the calendar
endpoints answer a clear error) even in an environment without them.

PKCE: google-auth-oauthlib's `Flow.authorization_url()` auto-generates a
PKCE `code_verifier` (see `Flow.__init__(autogenerate_code_verifier=True)`)
and sends its S256 challenge to Google. The token exchange happens in a
*different* request (POST /calendar/callback), so `build_authorization_url`
returns the verifier for the caller to store in the `oauth_states`
document, and `exchange_code` passes it back to a fresh Flow.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

SCOPES: List[str] = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]
REQUIRED_SCOPE = "https://www.googleapis.com/auth/calendar.events"

GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"

CALENDAR_NOT_CONFIGURED_MESSAGE = "Google Calendar is not configured."

# Google may return the granted scopes in a different order or (with
# granular consent) a subset; without this oauthlib raises a Warning
# instead of returning the token. We check the granted scopes ourselves.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")


class GoogleCalendarError(Exception):
    """A Google API / OAuth failure, carrying the HTTP status to answer with."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class CalendarAuthError(GoogleCalendarError):
    """The stored grant is unusable (revoked/expired refresh token): the
    user must reconnect their calendar."""

    def __init__(self, message: str = "Google Calendar access has expired or was revoked."):
        super().__init__(message, status_code=403)


# --- configuration -----------------------------------------------------------

def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID.strip() and settings.GOOGLE_CLIENT_SECRET.strip())


def require_configured() -> None:
    if not is_configured():
        raise HTTPException(status_code=503, detail=CALENDAR_NOT_CONFIGURED_MESSAGE)


def _client_config() -> Dict[str, Any]:
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": GOOGLE_AUTH_URI,
            "token_uri": GOOGLE_TOKEN_URI,
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }


# --- token helpers -------------------------------------------------------------

def get_calendar_tokens(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((user_doc or {}).get("google_calendar") or {})


def has_calendar_tokens(user_doc: Optional[Dict[str, Any]]) -> bool:
    """True if the user document holds a Google access or refresh token."""
    tokens = get_calendar_tokens(user_doc)
    return bool(tokens.get("refresh_token") or tokens.get("access_token"))


def _as_utc(value: Any) -> Optional[datetime]:
    """Normalise a stored expiry (datetime, naive = UTC, or ISO string) to aware UTC."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _token_fields_from_credentials(credentials: Any) -> Dict[str, Any]:
    expiry = _as_utc(getattr(credentials, "expiry", None))
    fields: Dict[str, Any] = {"access_token": credentials.token, "token_expiry": expiry}
    if getattr(credentials, "refresh_token", None):
        fields["refresh_token"] = credentials.refresh_token
    return fields


def _credentials_from_tokens(tokens: Dict[str, Any]) -> Any:
    from google.oauth2.credentials import Credentials

    expiry = _as_utc(tokens.get("token_expiry"))
    return Credentials(
        token=tokens.get("access_token"),
        refresh_token=tokens.get("refresh_token"),
        token_uri=GOOGLE_TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=tokens.get("scopes") or SCOPES,
        # google-auth compares against a naive UTC "now".
        expiry=expiry.replace(tzinfo=None) if expiry else None,
    )


# --- OAuth flow ---------------------------------------------------------------

def build_authorization_url(state: str) -> Tuple[str, Optional[str]]:
    """Return (consent-screen URL, PKCE code_verifier) for `state`."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        _client_config(), scopes=SCOPES, state=state, redirect_uri=settings.GOOGLE_REDIRECT_URI
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )
    return auth_url, flow.code_verifier


def exchange_code(code: str, code_verifier: Optional[str]) -> Dict[str, Any]:
    """Exchange an authorization code for tokens.

    Returns `{access_token, refresh_token?, token_expiry, scopes}`. Raises
    GoogleCalendarError (400 for a rejected/expired code or missing
    calendar permission, 502 for an unreachable Google).
    """
    from google_auth_oauthlib.flow import Flow
    from oauthlib.oauth2.rfc6749.errors import OAuth2Error

    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
        code_verifier=code_verifier,
        autogenerate_code_verifier=False,
    )
    try:
        token = flow.fetch_token(code=code)
    except OAuth2Error as exc:
        logger.warning("Google rejected the authorization code: %s", exc)
        raise GoogleCalendarError(
            "Google rejected the authorization code. Please try connecting your calendar again.",
            status_code=400,
        ) from exc
    except Exception as exc:
        logger.exception("Google token exchange failed")
        raise GoogleCalendarError(
            "Could not reach Google to finish connecting your calendar. Please try again shortly."
        ) from exc

    granted = token.get("scope") or SCOPES
    if isinstance(granted, str):
        granted = granted.split()
    granted = list(granted)
    if REQUIRED_SCOPE not in granted:
        raise GoogleCalendarError(
            "Calendar access was not granted. Please allow Mentora to manage calendar events.",
            status_code=400,
        )

    fields = _token_fields_from_credentials(flow.credentials)
    fields["scopes"] = granted
    return fields


def ensure_fresh_tokens(tokens: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """Refresh the access token if it is missing or expired.

    Returns `(tokens, refreshed)`; when `refreshed` is True the caller
    should persist the returned tokens. Raises CalendarAuthError if the
    grant can no longer be refreshed, GoogleCalendarError (502) if Google
    is unreachable.
    """
    expiry = _as_utc(tokens.get("token_expiry"))
    still_valid = bool(tokens.get("access_token")) and (
        expiry is None or (expiry - datetime.now(timezone.utc)).total_seconds() > 60
    )
    if still_valid:
        return tokens, False
    if not tokens.get("refresh_token"):
        raise CalendarAuthError()

    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request

    credentials = _credentials_from_tokens(tokens)
    try:
        credentials.refresh(Request())
    except RefreshError as exc:
        logger.warning("Google token refresh rejected: %s", exc)
        raise CalendarAuthError() from exc
    except Exception as exc:
        logger.exception("Google token refresh failed")
        raise GoogleCalendarError("Could not reach Google Calendar. Please try again shortly.") from exc

    refreshed = {**tokens, **_token_fields_from_credentials(credentials)}
    return refreshed, True


# --- events ---------------------------------------------------------------------

def _meet_link(event: Dict[str, Any]) -> Optional[str]:
    if event.get("hangoutLink"):
        return event["hangoutLink"]
    for entry in (event.get("conferenceData") or {}).get("entryPoints") or []:
        if entry.get("entryPointType") == "video" and entry.get("uri"):
            return entry["uri"]
    return None


def create_meet_event(
    tokens: Dict[str, Any],
    *,
    summary: str,
    description: str,
    start: datetime,
    end: datetime,
    time_zone: str,
    attendees: List[str],
) -> Dict[str, Any]:
    """Create an event with a Google Meet link on the token owner's primary
    calendar, inviting `attendees` (which puts it on their calendars too).

    Returns `{event_id, meet_link, html_link}`.
    """
    from google.auth.exceptions import RefreshError
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError

    body = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start.isoformat(), "timeZone": time_zone},
        "end": {"dateTime": end.isoformat(), "timeZone": time_zone},
        "attendees": [{"email": email} for email in attendees if email],
        "conferenceData": {
            "createRequest": {
                "requestId": uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
        "reminders": {"useDefault": True},
    }

    try:
        service = build("calendar", "v3", credentials=_credentials_from_tokens(tokens), cache_discovery=False)
        event = (
            service.events()
            .insert(calendarId="primary", body=body, conferenceDataVersion=1, sendUpdates="all")
            .execute()
        )
    except RefreshError as exc:
        raise CalendarAuthError() from exc
    except HttpError as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        logger.warning("Google Calendar API error %s: %s", status, exc)
        if status in (401, 403) and "insufficient" in str(exc).lower():
            raise CalendarAuthError(
                "Mentora is not allowed to create events on this calendar; please reconnect it."
            ) from exc
        raise GoogleCalendarError(
            f"Google Calendar could not create the event (HTTP {status or 'error'}). Please try again shortly."
        ) from exc
    except Exception as exc:
        logger.exception("Google Calendar event creation failed")
        raise GoogleCalendarError("Could not reach Google Calendar. Please try again shortly.") from exc

    return {
        "event_id": event.get("id") or "",
        "meet_link": _meet_link(event),
        "html_link": event.get("htmlLink"),
    }
