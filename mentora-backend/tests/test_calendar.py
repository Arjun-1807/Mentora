"""Tests for the Google Calendar endpoints (Section 2). Google is never
contacted: service functions / library entry points are monkeypatched."""
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from bson import ObjectId

from app.services import google_calendar as gcal
from tests.conftest import (
    COORDINATOR_PAYLOAD,
    MENTOR_PAYLOAD,
    STARTUP_PAYLOAD,
    auth_header,
    db,
    insert_match,
    me,
    register,
    register_coordinator,
)

FUTURE_MONDAY = "2099-01-05"
SLOT = {"date": FUTURE_MONDAY, "start_time": "10:00", "end_time": "10:30"}
TOKENS = {
    "access_token": "access",
    "refresh_token": "refresh",
    "token_expiry": datetime.now(timezone.utc) + timedelta(hours=1),
}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(gcal.settings, "GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(gcal.settings, "GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(gcal.settings, "GOOGLE_REDIRECT_URI", "http://localhost:3000/calendar/callback")


@pytest.fixture
def unconfigured(monkeypatch):
    monkeypatch.setattr(gcal.settings, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(gcal.settings, "GOOGLE_CLIENT_SECRET", "")


def _connect(fake_mongo, user_id, tokens=None):
    db(fake_mongo)["users"].update_one(
        {"_id": ObjectId(user_id)}, {"$set": {"google_calendar": dict(tokens or TOKENS)}}
    )


@pytest.fixture
def parties(client, fake_mongo):
    """A startup and a mentor (both registered) plus an accepted match."""
    startup_token = register(client, STARTUP_PAYLOAD)
    startup = me(client, startup_token)
    mentor_token = register(client, MENTOR_PAYLOAD)
    mentor = me(client, mentor_token)
    match = insert_match(
        fake_mongo,
        user_id=startup["user_id"],
        mentor_id=mentor["mentor_id"],
        status="accepted",
        startup_profile={"domain": "Clean Energy", "stage": "MVP", "challenges": [], "team_gaps": []},
    )
    return {
        "startup_token": startup_token,
        "startup": startup,
        "mentor_token": mentor_token,
        "mentor": mentor,
        "match": match,
    }


@pytest.fixture
def fake_event(monkeypatch):
    calls = []

    def create(tokens, **kwargs):
        calls.append({"tokens": tokens, **kwargs})
        return {"event_id": "evt-1", "meet_link": "https://meet.google.com/abc-defg-hij", "html_link": "https://cal/evt-1"}

    monkeypatch.setattr(gcal, "create_meet_event", create)
    return calls


def _book(client, parties, **overrides):
    body = {
        "mentor_id": parties["mentor"]["mentor_id"],
        "match_id": parties["match"]["match_id"],
        "slot": SLOT,
        "description": "Talk about fundraising",
        **overrides,
    }
    return client.post("/calendar/book", json=body, headers=auth_header(parties["startup_token"]))


# --- configuration ------------------------------------------------------------------

def test_auth_url_without_google_config_is_503(client, unconfigured):
    token = register(client, STARTUP_PAYLOAD)
    response = client.get("/calendar/auth-url", headers=auth_header(token))
    assert response.status_code == 503
    assert response.json()["error"] == "Google Calendar is not configured."


def test_callback_without_google_config_is_503(client, unconfigured):
    response = client.post("/calendar/callback", json={"code": "c", "state": "s"})
    assert response.status_code == 503


def test_auth_url_requires_authentication(client, configured):
    assert client.get("/calendar/auth-url").status_code == 401


# --- auth-url / callback --------------------------------------------------------------

def test_real_authorization_url_has_scopes_offline_consent_and_pkce(configured):
    url, verifier = gcal.build_authorization_url("state-123")
    query = parse_qs(urlparse(url).query)
    assert query["state"] == ["state-123"]
    assert query["access_type"] == ["offline"]
    assert query["prompt"] == ["consent"]
    assert query["redirect_uri"] == ["http://localhost:3000/calendar/callback"]
    assert set(query["scope"][0].split()) == set(gcal.SCOPES)
    assert query["code_challenge_method"] == ["S256"]
    assert verifier and len(verifier) >= 43


def test_auth_url_stores_state_with_code_verifier(client, fake_mongo, configured):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    response = client.get("/calendar/auth-url", headers=auth_header(token))
    assert response.status_code == 200, response.text
    auth_url = response.json()["auth_url"]
    state = parse_qs(urlparse(auth_url).query)["state"][0]

    doc = db(fake_mongo)["oauth_states"].find_one({"state": state})
    assert doc["user_id"] == user_id
    assert doc["code_verifier"]
    assert isinstance(doc["created_at"], datetime)


def test_exchange_code_sends_the_stored_code_verifier(configured, monkeypatch):
    from requests_oauthlib import OAuth2Session

    captured = {}

    def fake_fetch_token(self, token_url, **kwargs):
        captured.update(kwargs, token_url=token_url)
        self.token = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 3599,
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp(),
            "scope": gcal.SCOPES,
            "token_type": "Bearer",
        }
        return self.token

    monkeypatch.setattr(OAuth2Session, "fetch_token", fake_fetch_token)
    tokens = gcal.exchange_code("auth-code", "verifier-xyz")
    assert captured["code"] == "auth-code"
    assert captured["code_verifier"] == "verifier-xyz"
    assert captured["token_url"] == gcal.GOOGLE_TOKEN_URI
    assert tokens["access_token"] == "new-access"
    assert tokens["refresh_token"] == "new-refresh"
    assert tokens["token_expiry"].tzinfo is not None


def test_exchange_code_rejects_missing_calendar_scope(configured, monkeypatch):
    from requests_oauthlib import OAuth2Session

    def fake_fetch_token(self, token_url, **kwargs):
        self.token = {"access_token": "a", "scope": ["openid"], "token_type": "Bearer"}
        return self.token

    monkeypatch.setattr(OAuth2Session, "fetch_token", fake_fetch_token)
    with pytest.raises(gcal.GoogleCalendarError) as exc_info:
        gcal.exchange_code("auth-code", None)
    assert exc_info.value.status_code == 400


def test_callback_stores_tokens_and_consumes_state(client, fake_mongo, configured, monkeypatch):
    token = register_coordinator(client)
    user_id = me(client, token)["user_id"]
    monkeypatch.setattr(gcal, "build_authorization_url", lambda state: (f"https://accounts.google.com/x?state={state}", "v-1"))
    exchanged = []

    def fake_exchange(code, verifier):
        exchanged.append((code, verifier))
        return {"access_token": "a", "refresh_token": "r", "token_expiry": TOKENS["token_expiry"], "scopes": gcal.SCOPES}

    monkeypatch.setattr(gcal, "exchange_code", fake_exchange)

    auth_url = client.get("/calendar/auth-url", headers=auth_header(token)).json()["auth_url"]
    state = auth_url.split("state=")[1]

    response = client.post("/calendar/callback", json={"code": "the-code", "state": state})
    assert response.status_code == 200, response.text
    assert response.json() == {"success": True, "role": "coordinator"}
    assert exchanged == [("the-code", "v-1")]

    user = db(fake_mongo)["users"].find_one({"_id": ObjectId(user_id)})
    assert user["google_calendar"]["refresh_token"] == "r"
    assert db(fake_mongo)["oauth_states"].count_documents({}) == 0
    assert me(client, token)["calendar_connected"] is True
    assert client.get("/calendar/status", headers=auth_header(token)).json() == {"connected": True}

    # The state is single-use.
    again = client.post("/calendar/callback", json={"code": "the-code", "state": state})
    assert again.status_code == 400


def test_callback_keeps_existing_refresh_token_when_google_omits_it(client, fake_mongo, configured, monkeypatch):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    _connect(fake_mongo, user_id)
    db(fake_mongo)["oauth_states"].insert_one(
        {"state": "s1", "user_id": user_id, "code_verifier": None, "created_at": datetime.now(timezone.utc)}
    )
    monkeypatch.setattr(
        gcal, "exchange_code", lambda code, verifier: {"access_token": "fresh", "refresh_token": None, "token_expiry": None}
    )
    assert client.post("/calendar/callback", json={"code": "c", "state": "s1"}).status_code == 200
    stored = db(fake_mongo)["users"].find_one({"_id": ObjectId(user_id)})["google_calendar"]
    assert stored["access_token"] == "fresh"
    assert stored["refresh_token"] == "refresh"


def test_callback_rejects_unknown_state(client, configured):
    response = client.post("/calendar/callback", json={"code": "c", "state": "nope"})
    assert response.status_code == 400


def test_callback_rejects_expired_state(client, fake_mongo, configured, monkeypatch):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    db(fake_mongo)["oauth_states"].insert_one(
        {
            "state": "old",
            "user_id": user_id,
            "code_verifier": "v",
            "created_at": datetime.now(timezone.utc) - timedelta(minutes=16),
        }
    )
    monkeypatch.setattr(gcal, "exchange_code", lambda *a: pytest.fail("must not exchange an expired state"))
    response = client.post("/calendar/callback", json={"code": "c", "state": "old"})
    # Either the TTL index already purged it (mongomock honours TTL) or the
    # explicit age check rejects it - both are a 400 without a code exchange.
    assert response.status_code == 400
    assert "expired" in response.json()["error"] or "invalid" in response.json()["error"]


def test_callback_age_check_without_ttl_index(client, fake_mongo, configured, monkeypatch):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    # mongomock purges TTL-expired docs on read; use a collection without
    # the TTL index to exercise the endpoint's own age check.
    monkeypatch.setattr(gcal.settings, "MONGODB_OAUTH_STATES_COLLECTION", "oauth_states_no_ttl")
    states = db(fake_mongo)["oauth_states_no_ttl"]
    states.insert_one(
        {"state": "old", "user_id": user_id, "created_at": datetime.now(timezone.utc) - timedelta(minutes=16)}
    )
    monkeypatch.setattr(gcal, "exchange_code", lambda *a: pytest.fail("must not exchange an expired state"))
    response = client.post("/calendar/callback", json={"code": "c", "state": "old"})
    assert response.status_code == 400
    assert "expired" in response.json()["error"]


def test_callback_surfaces_google_errors(client, fake_mongo, configured, monkeypatch):
    token = register(client, STARTUP_PAYLOAD)
    user_id = me(client, token)["user_id"]
    for state in ("s-a", "s-b"):
        db(fake_mongo)["oauth_states"].insert_one(
            {"state": state, "user_id": user_id, "code_verifier": "v", "created_at": datetime.now(timezone.utc)}
        )

    def rejected(*_):
        raise gcal.GoogleCalendarError("Google rejected the authorization code.", status_code=400)

    monkeypatch.setattr(gcal, "exchange_code", rejected)
    assert client.post("/calendar/callback", json={"code": "c", "state": "s-a"}).status_code == 400

    def down(*_):
        raise gcal.GoogleCalendarError("Could not reach Google.")

    monkeypatch.setattr(gcal, "exchange_code", down)
    response = client.post("/calendar/callback", json={"code": "c", "state": "s-b"})
    assert response.status_code == 502
    assert response.json()["error"] == "Could not reach Google."


def test_status_defaults_to_not_connected(client):
    token = register(client, STARTUP_PAYLOAD)
    assert client.get("/calendar/status", headers=auth_header(token)).json() == {"connected": False}


# --- slots --------------------------------------------------------------------------------

def test_mentor_can_save_and_anyone_can_read_slots(client, fake_mongo):
    token = register(client, MENTOR_PAYLOAD)
    mentor_id = me(client, token)["mentor_id"]
    slots = [
        {"day": "Wednesday", "start_time": "14:00", "end_time": "15:00"},
        {"day": "Monday", "start_time": "09:00", "end_time": "11:00"},
        {"day": "Monday", "start_time": "09:00", "end_time": "11:00"},
    ]
    response = client.post("/calendar/slots", json={"slots": slots}, headers=auth_header(token))
    assert response.status_code == 200, response.text
    expected = [slots[1], slots[0]]
    assert response.json() == {"slots": expected}

    public = client.get(f"/calendar/slots/{mentor_id}")
    assert public.status_code == 200
    assert public.json() == {"slots": expected}
    stored = db(fake_mongo)["mentors"].find_one({"_id": ObjectId(mentor_id)})
    assert stored["availability_slots"] == expected


@pytest.mark.parametrize(
    "slot",
    [
        {"day": "Funday", "start_time": "09:00", "end_time": "10:00"},
        {"day": "monday", "start_time": "09:00", "end_time": "10:00"},
        {"day": "Monday", "start_time": "9:00", "end_time": "10:00"},
        {"day": "Monday", "start_time": "09:00", "end_time": "24:00"},
        {"day": "Monday", "start_time": "10:00", "end_time": "10:00"},
        {"day": "Monday", "start_time": "11:00", "end_time": "10:00"},
    ],
)
def test_invalid_slots_are_422(client, slot):
    token = register(client, MENTOR_PAYLOAD)
    response = client.post("/calendar/slots", json={"slots": [slot]}, headers=auth_header(token))
    assert response.status_code == 422


def test_only_mentors_can_save_slots(client):
    token = register(client, STARTUP_PAYLOAD)
    response = client.post(
        "/calendar/slots",
        json={"slots": [{"day": "Monday", "start_time": "09:00", "end_time": "10:00"}]},
        headers=auth_header(token),
    )
    assert response.status_code == 403


def test_slots_for_unknown_mentor_is_404(client):
    assert client.get("/calendar/slots/not-an-id").status_code == 404
    assert client.get(f"/calendar/slots/{ObjectId()}").status_code == 404


def test_slots_empty_by_default(client):
    token = register(client, MENTOR_PAYLOAD)
    mentor_id = me(client, token)["mentor_id"]
    assert client.get(f"/calendar/slots/{mentor_id}").json() == {"slots": []}


# --- booking ---------------------------------------------------------------------------------

def test_book_creates_event_and_schedules_match(client, fake_mongo, configured, parties, fake_event):
    _connect(fake_mongo, parties["startup"]["user_id"])
    _connect(fake_mongo, parties["mentor"]["user_id"])

    response = _book(client, parties)
    assert response.status_code == 200, response.text
    body = response.json()
    title = f"Mentora: Clean Energy × {MENTOR_PAYLOAD['profile']['name']}"
    assert body == {
        "success": True,
        "event_id": "evt-1",
        "meet_link": "https://meet.google.com/abc-defg-hij",
        "html_link": "https://cal/evt-1",
        "title": title,
        "start": "2099-01-05T10:00:00+05:30",
        "end": "2099-01-05T10:30:00+05:30",
    }

    call = fake_event[0]
    assert call["summary"] == title
    assert set(call["attendees"]) == {STARTUP_PAYLOAD["email"], MENTOR_PAYLOAD["email"]}
    assert call["time_zone"] == "Asia/Kolkata"
    assert "Talk about fundraising" in call["description"]

    match = db(fake_mongo)["matches"].find_one({"match_id": parties["match"]["match_id"]})
    assert match["status"] == "meeting_scheduled"
    assert match["meeting"] == {
        "date": FUTURE_MONDAY,
        "start_time": "10:00",
        "end_time": "10:30",
        "event_id": "evt-1",
        "meet_link": "https://meet.google.com/abc-defg-hij",
        "html_link": "https://cal/evt-1",
        "title": title,
    }


def test_book_requires_startup_calendar(client, fake_mongo, configured, parties, fake_event):
    _connect(fake_mongo, parties["mentor"]["user_id"])
    response = _book(client, parties)
    assert response.status_code == 403
    body = response.json()
    assert body["error"] == "calendar_not_connected"
    assert body["user"] == "startup"
    assert isinstance(body["detail"], str) and body["detail"]
    assert not fake_event


def test_book_requires_mentor_calendar(client, fake_mongo, configured, parties, fake_event):
    _connect(fake_mongo, parties["startup"]["user_id"])
    response = _book(client, parties)
    assert response.status_code == 403
    assert response.json()["error"] == "calendar_not_connected"
    assert response.json()["user"] == "mentor"
    assert not fake_event


def test_book_refreshes_and_persists_expired_tokens(client, fake_mongo, configured, parties, fake_event, monkeypatch):
    expired = {**TOKENS, "token_expiry": datetime.now(timezone.utc) - timedelta(minutes=5)}
    _connect(fake_mongo, parties["startup"]["user_id"], expired)
    _connect(fake_mongo, parties["mentor"]["user_id"])
    new_expiry = datetime.now(timezone.utc) + timedelta(hours=1)

    def fake_refresh(self, request):
        self.token = "refreshed-access"
        self.expiry = new_expiry.replace(tzinfo=None)

    from google.oauth2.credentials import Credentials

    monkeypatch.setattr(Credentials, "refresh", fake_refresh)
    response = _book(client, parties)
    assert response.status_code == 200, response.text
    assert fake_event[0]["tokens"]["access_token"] == "refreshed-access"
    stored = db(fake_mongo)["users"].find_one({"_id": ObjectId(parties["startup"]["user_id"])})["google_calendar"]
    assert stored["access_token"] == "refreshed-access"
    assert stored["refresh_token"] == "refresh"


def test_book_with_revoked_grant_asks_startup_to_reconnect(client, fake_mongo, configured, parties, fake_event, monkeypatch):
    _connect(fake_mongo, parties["startup"]["user_id"], {"access_token": "a", "token_expiry": datetime(2000, 1, 1)})
    _connect(fake_mongo, parties["mentor"]["user_id"])
    response = _book(client, parties)
    assert response.status_code == 403
    assert response.json()["user"] == "startup"


def test_book_google_failure_is_502(client, fake_mongo, configured, parties, monkeypatch):
    _connect(fake_mongo, parties["startup"]["user_id"])
    _connect(fake_mongo, parties["mentor"]["user_id"])

    def failing(*a, **k):
        raise gcal.GoogleCalendarError("Google Calendar could not create the event (HTTP 500).")

    monkeypatch.setattr(gcal, "create_meet_event", failing)
    response = _book(client, parties)
    assert response.status_code == 502
    assert "Google Calendar" in response.json()["error"]
    match = db(fake_mongo)["matches"].find_one({"match_id": parties["match"]["match_id"]})
    assert match["status"] == "accepted"


def test_book_only_for_startups(client, configured, parties):
    response = client.post(
        "/calendar/book",
        json={"mentor_id": parties["mentor"]["mentor_id"], "match_id": parties["match"]["match_id"], "slot": SLOT},
        headers=auth_header(parties["mentor_token"]),
    )
    assert response.status_code == 403


def test_book_unconfigured_is_503(client, unconfigured, parties):
    assert _book(client, parties).status_code == 503


def test_book_checks_match_ownership_and_mentor(client, fake_mongo, configured, parties, fake_event):
    assert _book(client, parties, match_id="missing").status_code == 404
    assert _book(client, parties, mentor_id=str(ObjectId())).status_code == 400

    other = insert_match(
        fake_mongo, user_id="507f1f77bcf86cd799439011", mentor_id=parties["mentor"]["mentor_id"], status="accepted"
    )
    assert _book(client, parties, match_id=other["match_id"]).status_code == 403


def test_book_requires_an_accepted_match(client, fake_mongo, configured, parties, fake_event):
    db(fake_mongo)["matches"].update_one({"_id": parties["match"]["_id"]}, {"$set": {"status": "email_sent"}})
    assert _book(client, parties).status_code == 409


def test_book_rejects_past_and_invalid_slots(client, configured, parties, fake_event):
    assert _book(client, parties, slot={**SLOT, "date": "2001-01-01"}).status_code == 422
    assert _book(client, parties, slot={**SLOT, "date": "2099-02-30"}).status_code == 422
    assert _book(client, parties, slot={**SLOT, "start_time": "11:00"}).status_code == 422


def test_book_respects_mentor_availability(client, fake_mongo, configured, parties, fake_event):
    _connect(fake_mongo, parties["startup"]["user_id"])
    _connect(fake_mongo, parties["mentor"]["user_id"])
    db(fake_mongo)["mentors"].update_one(
        {"_id": ObjectId(parties["mentor"]["mentor_id"])},
        {"$set": {"availability_slots": [{"day": "Tuesday", "start_time": "09:00", "end_time": "12:00"}]}},
    )
    assert _book(client, parties).status_code == 409  # 2099-01-05 is a Monday

    db(fake_mongo)["mentors"].update_one(
        {"_id": ObjectId(parties["mentor"]["mentor_id"])},
        {"$set": {"availability_slots": [{"day": "Monday", "start_time": "09:00", "end_time": "12:00"}]}},
    )
    assert _book(client, parties).status_code == 200


# --- service internals --------------------------------------------------------------------------

def test_ensure_fresh_tokens_keeps_valid_tokens():
    tokens, refreshed = gcal.ensure_fresh_tokens(dict(TOKENS))
    assert refreshed is False and tokens["access_token"] == "access"


def test_ensure_fresh_tokens_without_refresh_token_needs_reconnect():
    with pytest.raises(gcal.CalendarAuthError):
        gcal.ensure_fresh_tokens({"access_token": "a", "token_expiry": datetime(2000, 1, 1)})


def test_create_meet_event_requests_a_meet_conference(configured, monkeypatch):
    import googleapiclient.discovery

    captured = {}

    class FakeRequest:
        def execute(self):
            return {
                "id": "evt-9",
                "htmlLink": "https://calendar.google.com/evt-9",
                "conferenceData": {"entryPoints": [{"entryPointType": "video", "uri": "https://meet.google.com/x"}]},
            }

    class FakeEvents:
        def insert(self, **kwargs):
            captured.update(kwargs)
            return FakeRequest()

    class FakeService:
        def events(self):
            return FakeEvents()

    monkeypatch.setattr(googleapiclient.discovery, "build", lambda *a, **k: FakeService())
    from zoneinfo import ZoneInfo

    zone = ZoneInfo("Asia/Kolkata")
    result = gcal.create_meet_event(
        dict(TOKENS),
        summary="Mentora: Fintech × Ada",
        description="d",
        start=datetime(2099, 1, 5, 10, 0, tzinfo=zone),
        end=datetime(2099, 1, 5, 10, 30, tzinfo=zone),
        time_zone="Asia/Kolkata",
        attendees=["a@example.com", "b@example.com"],
    )
    assert result == {"event_id": "evt-9", "meet_link": "https://meet.google.com/x", "html_link": "https://calendar.google.com/evt-9"}
    assert captured["calendarId"] == "primary"
    assert captured["conferenceDataVersion"] == 1
    assert captured["sendUpdates"] == "all"
    body = captured["body"]
    assert body["conferenceData"]["createRequest"]["conferenceSolutionKey"] == {"type": "hangoutsMeet"}
    assert body["attendees"] == [{"email": "a@example.com"}, {"email": "b@example.com"}]
    assert body["start"]["dateTime"] == "2099-01-05T10:00:00+05:30"
