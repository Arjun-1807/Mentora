"""Phase 2: server-side journey and the match lifecycle.

Covers the state machine (allowed / forbidden moves, history, no
regressions via the mentor PATCH), the request endpoint (ownership, status,
server-side recipient, rate limit, log + smtp delivery), mentor-side leaks,
pair identity across decks, superseding, replacements, lazy expiry with a
fake clock, startup records / profile versions, and the migration.
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import pytest
from bson import ObjectId

from app.models.schemas import MentorMatch
from app.services import matches as match_service
from app.services.matches import TransitionError, transition_match
from scripts.migrate_v2 import _changes, migrate
from tests.conftest import (
    MENTOR_PAYLOAD,
    STARTUP_PAYLOAD,
    auth_header,
    db,
    insert_match,
    me,
    register,
)

PROFILE = {
    "domain": "Clean Energy",
    "stage": "MVP",
    "challenges": ["Fleet financing"],
    "team_gaps": ["No CFO"],
    "geography": "Bangalore",
}
OTHER_STARTUP = {**STARTUP_PAYLOAD, "email": "rival@example.com"}


# --- fixtures ---------------------------------------------------------------------------------

class Ranking:
    """Fake find_matching_mentors: returns `order` (minus exclusions), top 5."""

    def __init__(self, mentor_ids: List[str]):
        self.order = list(mentor_ids)
        self.calls: List[Optional[List[str]]] = []

    def __call__(self, profile, exclude_mentor_ids=None):
        excluded = set(exclude_mentor_ids or [])
        self.calls.append(sorted(excluded))
        picked = [m for m in self.order if m not in excluded][:5]
        return [
            MentorMatch(
                mentor_id=mentor_id, name=f"Mentor {mentor_id[-4:]}", domain="Clean Energy", stage_focus="MVP",
                expertise=["Fundraising"], match_score=round(0.9 - i / 100, 4), email=f"{mentor_id}@mentors.io",
            )
            for i, mentor_id in enumerate(picked)
        ]


@pytest.fixture
def mentors(fake_mongo):
    collection = db(fake_mongo)["mentors"]
    ids = []
    for i in range(8):
        oid = ObjectId()
        collection.insert_one(
            {"_id": oid, "name": f"Mentor {str(oid)[-4:]}", "domain": "Clean Energy", "stage_focus": "MVP",
             "expertise": ["Fundraising"], "email": f"{oid}@mentors.io"}
        )
        ids.append(str(oid))
    return ids


@pytest.fixture
def ranking(monkeypatch, mentors):
    from app.routers import match as match_router
    from app.services import mentor_matching

    fake = Ranking(mentors)
    monkeypatch.setattr(match_router, "find_matching_mentors", fake)
    monkeypatch.setattr(mentor_matching, "find_matching_mentors", fake)
    return fake


@pytest.fixture
def startup(client):
    token = register(client, STARTUP_PAYLOAD)
    return {"token": token, "user": me(client, token)}


def _match(client, token, body=PROFILE):
    response = client.post("/match", json=body, headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()["matches"]


def _request(client, token, match_id, subject="Intro", body="Hello mentor"):
    return client.post(
        f"/matches/{match_id}/request", json={"subject": subject, "body": body}, headers=auth_header(token)
    )


def _list(client, token):
    response = client.get("/matches", headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()["matches"]


def _matches(fake_mongo):
    return db(fake_mongo)["matches"]


def _claim_mentor(client, fake_mongo, mentor_id: str, email="claimed@mentors.io") -> str:
    """Register a mentor account and link it to an existing seeded mentor doc."""
    token = register(client, {**MENTOR_PAYLOAD, "email": email})
    user = me(client, token)
    database = db(fake_mongo)
    database["users"].update_one({"_id": ObjectId(user["user_id"])}, {"$set": {"mentor_id": mentor_id}})
    database["mentors"].update_one({"_id": ObjectId(mentor_id)}, {"$set": {"user_id": user["user_id"]}})
    return token


# --- state machine ----------------------------------------------------------------------------

def _raw(fake_mongo, status="suggested", **fields):
    doc = {"match_id": "m", "user_id": "u", "mentor_id": "x", "status": status, **fields}
    _matches(fake_mongo).insert_one(doc)
    return doc


@pytest.mark.parametrize(
    "start,to,role",
    [
        ("suggested", "requested", "startup"),
        ("suggested", "superseded", "system"),
        ("requested", "accepted", "mentor"),
        ("requested", "declined", "mentor"),
        ("requested", "withdrawn", "startup"),
        ("requested", "expired", "system"),
        ("accepted", "meeting_scheduled", "startup"),
        ("meeting_scheduled", "met", "mentor"),
        ("meeting_scheduled", "completed", "startup"),
        ("met", "completed", "mentor"),
        ("superseded", "suggested", "system"),
        ("pending", "requested", "startup"),      # legacy spelling of suggested
        ("email_sent", "accepted", "mentor"),     # legacy spelling of requested
    ],
)
def test_allowed_transitions_record_history(fake_mongo, start, to, role):
    _raw(fake_mongo, start)
    doc = transition_match("m", role, "actor-1", to, {"note": "x"}, side_effects=False)
    assert doc["status"] == to and doc["note"] == "x"
    assert doc["history"][-1]["from"] == match_service.normalise_status(start)
    assert doc["history"][-1]["to"] == to
    assert doc["history"][-1]["by_role"] == role
    assert doc["history"][-1]["by_user_id"] == "actor-1"
    assert doc["status_updated_at"]


@pytest.mark.parametrize(
    "start,to,role",
    [
        ("suggested", "accepted", "mentor"),         # mentor can't accept an unsent suggestion
        ("suggested", "requested", "mentor"),
        ("requested", "accepted", "startup"),        # startup can't accept for the mentor
        ("requested", "withdrawn", "mentor"),
        ("accepted", "requested", "startup"),        # no regression
        ("accepted", "declined", "mentor"),
        ("meeting_scheduled", "accepted", "mentor"),
        ("completed", "met", "startup"),
        ("declined", "accepted", "mentor"),
        ("expired", "requested", "startup"),
        ("withdrawn", "requested", "startup"),
        ("suggested", "completed", "startup"),
    ],
)
def test_forbidden_transitions_change_nothing(fake_mongo, start, to, role):
    _raw(fake_mongo, start)
    with pytest.raises(TransitionError) as info:
        transition_match("m", role, "actor-1", to, side_effects=False)
    assert info.value.status_code == 409
    doc = _matches(fake_mongo).find_one({"match_id": "m"})
    assert doc["status"] == start and "history" not in doc


def test_transition_unknown_match_is_404(fake_mongo):
    with pytest.raises(TransitionError) as info:
        transition_match("nope", "startup", None, "requested")
    assert info.value.status_code == 404


def test_transition_loses_a_race_cleanly(fake_mongo):
    """The atomic filter includes the status that was read."""
    doc = _raw(fake_mongo, "requested")
    stale = dict(doc)
    transition_match("m", "mentor", None, "accepted", doc=stale, side_effects=False)
    with pytest.raises(TransitionError):
        # Same stale snapshot ("requested"): the decline must not overwrite the accept.
        transition_match("m", "mentor", None, "declined", doc=stale, side_effects=False)
    assert _matches(fake_mongo).find_one({"match_id": "m"})["status"] == "accepted"


def test_advance_wrapper_is_forward_only(fake_mongo):
    _raw(fake_mongo, "pending")
    assert match_service.advance_match_status("m", "u", "emailed") is False  # emailed == suggested
    assert match_service.advance_match_status("m", "u", "email_sent") is True
    assert _matches(fake_mongo).find_one({"match_id": "m"})["status"] == "requested"
    assert match_service.advance_match_status("m", "u", "accepted") is True
    assert match_service.advance_match_status("m", "u", "email_sent") is False
    assert match_service.advance_match_status("m", "other-user", "completed") is False


# --- mentor PATCH ---------------------------------------------------------------------------

def test_mentor_patch_cannot_regress_or_flip(client, fake_mongo, mentors):
    mentor_token = _claim_mentor(client, fake_mongo, mentors[0])
    for status, target in (("accepted", "declined"), ("meeting_scheduled", "accepted"), ("completed", "declined"),
                           ("declined", "accepted"), ("withdrawn", "accepted")):
        match = insert_match(fake_mongo, user_id="507f1f77bcf86cd799439011", mentor_id=mentors[0], status=status)
        response = client.patch(
            f"/mentor/matches/{match['match_id']}", json={"status": target}, headers=auth_header(mentor_token)
        )
        assert response.status_code == 409, (status, target, response.text)
        assert _matches(fake_mongo).find_one({"_id": match["_id"]})["status"] == status


def test_mentor_patch_accepts_either_id_and_is_idempotent(client, fake_mongo, mentors):
    mentor_token = _claim_mentor(client, fake_mongo, mentors[0])
    match = insert_match(fake_mongo, user_id="507f1f77bcf86cd799439011", mentor_id=mentors[0], status="requested")
    first = client.patch(f"/mentor/matches/{match['match_id']}", json={"status": "accepted"},
                         headers=auth_header(mentor_token))
    assert first.status_code == 200 and first.json()["status"] == "accepted"
    again = client.patch(f"/mentor/matches/{match['_id']}", json={"status": "accepted"},
                         headers=auth_header(mentor_token))
    assert again.status_code == 200
    doc = _matches(fake_mongo).find_one({"_id": match["_id"]})
    assert [h["to"] for h in doc["history"]] == ["accepted"]
    assert doc["history"][0]["by_role"] == "mentor"


def test_mentor_patch_foreign_match_is_403(client, fake_mongo, mentors):
    mentor_token = _claim_mentor(client, fake_mongo, mentors[0])
    match = insert_match(fake_mongo, user_id="507f1f77bcf86cd799439011", mentor_id=mentors[1], status="requested")
    response = client.patch(f"/mentor/matches/{match['match_id']}", json={"status": "accepted"},
                            headers=auth_header(mentor_token))
    assert response.status_code == 403


# --- request endpoint -------------------------------------------------------------------------

def test_request_sends_to_the_mentor_on_file_and_logs_it(client, fake_mongo, ranking, startup):
    suggestions = _match(client, startup["token"])
    target = suggestions[0]
    response = client.post(
        f"/matches/{target['match_id']}/request",
        # A client-supplied recipient is ignored: the body has no such field.
        json={"subject": "Intro from GreenHaul", "body": "Hi, can we talk?", "to": "attacker@evil.io"},
        headers=auth_header(startup["token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["delivery"] == "log"
    assert body["match"]["status"] == "requested"

    outbox = list(db(fake_mongo)["outbox"].find())
    assert len(outbox) == 1
    mail = outbox[0]
    assert mail["to"] == f"{target['mentor_id']}@mentors.io"
    assert mail["subject"] == "Intro from GreenHaul"
    assert mail["body"].startswith("Hi, can we talk?")
    assert "/mentor/dashboard?tab=requests" in mail["body"]
    assert mail["reply_to"] == STARTUP_PAYLOAD["email"]
    assert mail["status"] == "logged" and mail["kind"] == "intro_request"

    doc = _matches(fake_mongo).find_one({"match_id": target["match_id"]})
    assert doc["status"] == "requested" and doc["requested_at"] and doc["email_sent_at"]
    assert doc["request"]["subject"] == "Intro from GreenHaul"
    assert doc["history"][-1] == {**doc["history"][-1], "from": "suggested", "to": "requested", "by_role": "startup"}
    assert "request_lock" not in doc


def test_request_status_and_ownership(client, fake_mongo, ranking, startup):
    target = _match(client, startup["token"])[0]
    assert _request(client, startup["token"], target["match_id"]).status_code == 200
    again = _request(client, startup["token"], target["match_id"])
    assert again.status_code == 409
    assert db(fake_mongo)["outbox"].count_documents({}) == 1

    rival = register(client, OTHER_STARTUP)
    other = _match(client, startup["token"])[1]
    assert _request(client, rival, other["match_id"]).status_code == 403
    assert _request(client, rival, "does-not-exist").status_code == 404

    mentor_token = register(client, MENTOR_PAYLOAD)
    assert _request(client, mentor_token, other["match_id"]).status_code == 403
    assert db(fake_mongo)["outbox"].count_documents({}) == 1


def test_request_validates_body(client, ranking, startup):
    target = _match(client, startup["token"])[0]
    assert _request(client, startup["token"], target["match_id"], subject="  ").status_code == 422
    assert _request(client, startup["token"], target["match_id"], body="x" * 10_001).status_code == 422


def test_request_is_rate_limited(client, fake_mongo, ranking, startup, monkeypatch):
    from app.services import rate_limit

    monkeypatch.setattr(rate_limit.match_request_limiter, "limit", 2)
    suggestions = _match(client, startup["token"])
    assert _request(client, startup["token"], suggestions[0]["match_id"]).status_code == 200
    assert _request(client, startup["token"], suggestions[1]["match_id"]).status_code == 200
    limited = _request(client, startup["token"], suggestions[2]["match_id"])
    assert limited.status_code == 429
    assert limited.headers.get("Retry-After")
    assert _matches(fake_mongo).find_one({"match_id": suggestions[2]["match_id"]})["status"] == "suggested"


def test_request_over_smtp(client, fake_mongo, ranking, startup, monkeypatch):
    from app.config import settings
    from app.services import mailer

    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent.append(("connect", host, port))

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def login(self, user, password):
            sent.append(("login", user, password))

        def send_message(self, message):
            sent.append(("send", message["To"], message["Reply-To"], message["Subject"]))

    monkeypatch.setattr(settings, "GMAIL_USER", "mentora@gmail.com")
    monkeypatch.setattr(settings, "GMAIL_APP_PASSWORD", "app-password")
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    assert mailer.delivery_mode() == "smtp"

    target = _match(client, startup["token"])[0]
    response = _request(client, startup["token"], target["match_id"], subject="Hi")
    assert response.status_code == 200
    assert response.json()["delivery"] == "smtp"
    assert ("send", f"{target['mentor_id']}@mentors.io", STARTUP_PAYLOAD["email"], "Hi") in sent
    assert db(fake_mongo)["outbox"].find_one()["status"] == "sent"


def test_failed_smtp_leaves_the_match_suggested(client, fake_mongo, ranking, startup, monkeypatch):
    from app.config import settings
    from app.services import mailer

    def broken(*args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(settings, "EMAIL_DELIVERY", "smtp")
    monkeypatch.setattr(settings, "GMAIL_USER", "mentora@gmail.com")
    monkeypatch.setattr(settings, "GMAIL_APP_PASSWORD", "app-password")
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", broken)

    target = _match(client, startup["token"])[0]
    response = _request(client, startup["token"], target["match_id"])
    assert response.status_code == 502
    doc = _matches(fake_mongo).find_one({"match_id": target["match_id"]})
    assert doc["status"] == "suggested" and "request_lock" not in doc
    assert db(fake_mongo)["outbox"].find_one()["status"] == "failed"
    # And it can be retried once delivery works.
    monkeypatch.setattr(settings, "EMAIL_DELIVERY", "log")
    assert _request(client, startup["token"], target["match_id"]).status_code == 200


def test_explicit_smtp_without_credentials_fails_loudly(monkeypatch):
    from app.config import settings
    from app.services import mailer

    monkeypatch.setattr(settings, "EMAIL_DELIVERY", "smtp")
    monkeypatch.setattr(settings, "GMAIL_USER", "")
    with pytest.raises(mailer.MailError):
        mailer.send_mail(to="a@b.io", subject="s", body="b")


def test_withdraw(client, fake_mongo, ranking, startup):
    suggestions = _match(client, startup["token"])
    target = suggestions[0]
    assert client.post(f"/matches/{target['match_id']}/withdraw", headers=auth_header(startup["token"])).status_code == 409
    _request(client, startup["token"], target["match_id"])
    response = client.post(f"/matches/{target['match_id']}/withdraw", headers=auth_header(startup["token"]))
    assert response.status_code == 200
    assert response.json()["match"]["status"] == "withdrawn"
    replacement = _matches(fake_mongo).find_one({"replacement_for": target["match_id"]})
    assert replacement is not None and replacement["status"] == "suggested"


# --- leaks ------------------------------------------------------------------------------------

def test_mentor_sees_only_requests_and_email_only_after_accept(client, fake_mongo, ranking, startup):
    suggestions = _match(client, startup["token"])
    target = suggestions[0]
    mentor_token = _claim_mentor(client, fake_mongo, target["mentor_id"])

    # A suggestion is invisible: listing, status filter, legacy listing, PATCH, health.
    assert client.get("/mentor/matches", headers=auth_header(mentor_token)).json()["matches"] == []
    assert client.get("/mentor/matches", params={"status": "suggested,pending"},
                      headers=auth_header(mentor_token)).json()["matches"] == []
    assert client.post("/matches/all", headers=auth_header(mentor_token)).json()["matches"] == []
    assert client.patch(f"/mentor/matches/{target['match_id']}", json={"status": "accepted"},
                        headers=auth_header(mentor_token)).status_code == 404
    assert client.get(f"/health/{startup['user']['user_id']}", headers=auth_header(mentor_token)).status_code == 403
    assert client.get("/mentor/stats", headers=auth_header(mentor_token)).json()["pending_requests"] == 0

    client.patch("/startup/me", json={"company_name": "GreenHaul"}, headers=auth_header(startup["token"]))
    _request(client, startup["token"], target["match_id"], body="Please mentor us")
    inbox = client.get("/mentor/matches", params={"status": "requested"}, headers=auth_header(mentor_token)).json()["matches"]
    assert len(inbox) == 1
    item = inbox[0]
    assert item["startup_email"] is None
    assert STARTUP_PAYLOAD["email"] not in str(item)
    assert item["company_name"] == "GreenHaul"
    assert item["startup_summary"]["domain"] == "Clean Energy"
    assert item["request"]["body"] == "Please mentor us"
    assert client.get("/mentor/stats", headers=auth_header(mentor_token)).json()["pending_requests"] == 1
    legacy = client.post("/matches/all", headers=auth_header(mentor_token)).json()["matches"]
    assert [m["startup_email"] for m in legacy] == [None]

    accepted = client.patch(f"/mentor/matches/{target['match_id']}", json={"status": "accepted"},
                            headers=auth_header(mentor_token))
    assert accepted.status_code == 200
    after = client.get("/mentor/matches", headers=auth_header(mentor_token)).json()["matches"]
    assert after[0]["startup_email"] == STARTUP_PAYLOAD["email"]

    # The startup was notified.
    note = db(fake_mongo)["outbox"].find_one({"kind": "request_accepted"})
    assert note["to"] == STARTUP_PAYLOAD["email"] and "/matches" in note["body"]


# --- pairs across decks / superseded / replacement ---------------------------------------------

def test_new_deck_refreshes_pairs_and_keeps_accepted_actionable(client, fake_mongo, ranking, mentors, startup):
    first = _match(client, startup["token"])
    accepted_id = first[0]["match_id"]
    _request(client, startup["token"], accepted_id)
    mentor_token = _claim_mentor(client, fake_mongo, first[0]["mentor_id"])
    client.patch(f"/mentor/matches/{accepted_id}", json={"status": "accepted"}, headers=auth_header(mentor_token))

    # New deck: a different top 5 in which the accepted mentor drops to #5 and
    # mentors[1..3] fall out.
    ranking.order = [mentors[5], mentors[6], mentors[7], mentors[4], mentors[0]]
    second = _match(client, startup["token"], {**PROFILE, "challenges": ["Hiring drivers"]})
    assert second[4]["match_id"] == accepted_id
    assert second[4]["status"] == "accepted"

    docs = {d["mentor_id"]: d for d in _matches(fake_mongo).find()}
    assert len(docs) == 8  # one document per (startup, mentor) pair
    assert docs[mentors[0]]["status"] == "accepted" and docs[mentors[0]]["active"] is True
    assert docs[mentors[0]]["startup_profile"]["challenges"] == ["Hiring drivers"]
    for gone in mentors[1:4]:
        assert docs[gone]["status"] == "superseded" and docs[gone]["active"] is False
    assert docs[mentors[4]]["status"] == "suggested"

    listed = {m["mentor_id"]: m for m in _list(client, startup["token"])}
    assert set(listed) == {mentors[0], mentors[4], mentors[5], mentors[6], mentors[7]}
    assert listed[mentors[0]]["status"] == "accepted"
    assert listed[mentors[0]]["name"] and listed[mentors[0]]["email"]

    # A superseded mentor that comes back is revived, not duplicated.
    ranking.order = [mentors[1]] + mentors[4:8]
    third = _match(client, startup["token"], PROFILE)
    revived = _matches(fake_mongo).find_one({"mentor_id": mentors[1]})
    assert third[0]["match_id"] == revived["match_id"] and revived["status"] == "suggested"
    assert [h["to"] for h in revived["history"]] == ["suggested", "superseded", "suggested"]
    assert _matches(fake_mongo).count_documents({}) == 8


def test_decline_adds_a_replacement_excluding_known_mentors(client, fake_mongo, ranking, mentors, startup):
    suggestions = _match(client, startup["token"])
    target = suggestions[0]
    _request(client, startup["token"], target["match_id"])
    mentor_token = _claim_mentor(client, fake_mongo, target["mentor_id"])
    response = client.patch(f"/mentor/matches/{target['match_id']}", json={"status": "declined"},
                            headers=auth_header(mentor_token))
    assert response.status_code == 200

    replacement = _matches(fake_mongo).find_one({"replacement_for": target["match_id"]})
    assert replacement["status"] == "suggested" and replacement["active"] is True
    assert replacement["mentor_id"] == mentors[5]  # first mentor without a match
    assert sorted(ranking.calls[-1]) == sorted(m["mentor_id"] for m in suggestions)

    listed = {m["match_id"]: m for m in _list(client, startup["token"])}
    assert listed[target["match_id"]]["status"] == "declined"
    assert listed[replacement["match_id"]]["replacement_for_name"] == target["name"]

    note = db(fake_mongo)["outbox"].find_one({"kind": "request_declined"})
    assert note["to"] == STARTUP_PAYLOAD["email"] and "new mentor suggestion" in note["body"]

    # A declined mentor is never re-suggested by a later /match.
    _match(client, startup["token"])
    assert target["mentor_id"] in ranking.calls[-1]
    assert _matches(fake_mongo).count_documents({"mentor_id": target["mentor_id"]}) == 1


# --- lazy expiry ----------------------------------------------------------------------------

def test_requests_expire_lazily_after_seven_days(client, fake_mongo, ranking, startup, monkeypatch):
    suggestions = _match(client, startup["token"])
    target = suggestions[0]
    _request(client, startup["token"], target["match_id"])

    real_now = match_service.now_utc()
    monkeypatch.setattr(match_service, "now_utc", lambda: real_now + timedelta(days=6, hours=23))
    assert {m["match_id"]: m["status"] for m in _list(client, startup["token"])}[target["match_id"]] == "requested"

    monkeypatch.setattr(match_service, "now_utc", lambda: real_now + timedelta(days=7, minutes=1))
    listed = {m["match_id"]: m for m in _list(client, startup["token"])}
    assert listed[target["match_id"]]["status"] == "expired"
    doc = _matches(fake_mongo).find_one({"match_id": target["match_id"]})
    assert doc["history"][-1]["by_role"] == "system" and doc["active"] is False
    replacement = _matches(fake_mongo).find_one({"replacement_for": target["match_id"]})
    assert replacement is not None and replacement["match_id"] in listed


# --- startup records and profile versions ------------------------------------------------------

def test_startup_me_and_profile_versions(client, fake_mongo, ranking, startup):
    token = startup["token"]
    me_body = client.get("/startup/me", headers=auth_header(token)).json()
    assert me_body["active_profile"] is None
    assert me_body["company_name"] == "Acme"  # from the registration profile

    # /match with an empty body needs a profile first.
    assert client.post("/match", headers=auth_header(token)).status_code == 409

    _match(client, token)  # legacy body -> saved as version 1
    patched = client.patch(
        "/startup/profiles/active", json={"geography": "Pune", "team_gaps": ["No CTO", "No CTO", " "]},
        headers=auth_header(token),
    )
    assert patched.status_code == 200, patched.text
    active = patched.json()["active_profile"]
    assert active["version"] == 2 and active["source"] == "manual"
    assert active["profile"]["geography"] == "Pune"
    assert active["profile"]["team_gaps"] == ["No CTO"]
    assert active["profile"]["challenges"] == PROFILE["challenges"]

    versions = client.get("/startup/profiles", headers=auth_header(token)).json()["profiles"]
    assert [v["version"] for v in versions] == [2, 1]
    assert [v["active"] for v in versions] == [True, False]

    renamed = client.patch("/startup/me", json={"company_name": "  GreenHaul  "}, headers=auth_header(token))
    assert renamed.json()["company_name"] == "GreenHaul"

    # Empty-body /match uses the active (corrected) profile.
    response = client.post("/match", headers=auth_header(token))
    assert response.status_code == 200
    doc = _matches(fake_mongo).find_one({"mentor_id": response.json()["matches"][0]["mentor_id"]})
    assert doc["startup_profile"]["geography"] == "Pune"
    assert doc["profile_id"] == active["profile_id"]

    assert client.patch("/startup/profiles/active", json={}, headers=auth_header(token)).status_code == 422
    assert client.patch("/startup/profiles/active", json={"stage": "seed"}, headers=auth_header(token)).status_code == 422
    mentor_token = register(client, MENTOR_PAYLOAD)
    assert client.get("/startup/me", headers=auth_header(mentor_token)).status_code == 403


def test_extract_saves_a_new_version_each_deck(client, fake_mongo, startup, monkeypatch):
    import pymupdf

    from app.models.schemas import StartupProfile
    from app.routers import extract as extract_router
    from tests.conftest import DECK_TEXT

    monkeypatch.setattr(
        extract_router, "extract_startup_profile",
        lambda text: StartupProfile(domain="Clean Energy", stage="MVP", challenges=["Range"]),
    )
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), DECK_TEXT)
    pdf = document.tobytes()

    for expected in (1, 2):
        response = client.post("/extract", files={"file": ("GreenHaul.pdf", pdf, "application/pdf")},
                               headers=auth_header(startup["token"]))
        assert response.status_code == 200, response.text
        assert response.json()["version"] == expected
    active = client.get("/startup/me", headers=auth_header(startup["token"])).json()["active_profile"]
    assert active["version"] == 2 and active["source"] == "deck"
    assert active["deck_filename"] == "GreenHaul.pdf"
    assert active["deck_feedback"]["confidence_score"] == 60  # default feedback in tests


def test_legacy_matches_are_adopted_on_first_use(client, fake_mongo, startup, mentors):
    user_id = startup["user"]["user_id"]
    old = insert_match(fake_mongo, user_id=user_id, mentor_id=mentors[0], status="pending",
                       timestamp="2026-09-01T00:00:00+00:00")
    best = insert_match(fake_mongo, user_id=user_id, mentor_id=mentors[0], status="accepted",
                        timestamp="2026-09-02T00:00:00+00:00")
    listed = _list(client, startup["token"])
    assert [m["match_id"] for m in listed] == [best["match_id"]]
    loser = _matches(fake_mongo).find_one({"match_id": old["match_id"]})
    assert loser["active"] is False and loser["duplicate_of"] == best["match_id"]
    profile = client.get("/startup/me", headers=auth_header(startup["token"])).json()["active_profile"]
    assert profile["source"] == "migration" and profile["profile"]["domain"] == "Fintech"


# --- outcomes under the new statuses -------------------------------------------------------------

def test_health_log_marks_met_and_feedback_completes(client, fake_mongo, mentors, startup):
    match = insert_match(fake_mongo, user_id=startup["user"]["user_id"], mentor_id=mentors[0], status="accepted")
    body = {"match_id": match["match_id"], "momentum_score": 4, "blockers_resolved": True, "mentor_engagement": 4}
    assert client.post("/health/log", json=body, headers=auth_header(startup["token"])).status_code == 409

    _matches(fake_mongo).update_one({"_id": match["_id"]}, {"$set": {"status": "meeting_scheduled"}})
    assert client.post("/health/log", json=body, headers=auth_header(startup["token"])).status_code == 200
    assert _matches(fake_mongo).find_one({"_id": match["_id"]})["status"] == "met"

    feedback = client.post("/feedback", json={"match_id": match["match_id"], "mentor_id": mentors[0],
                                              "attended": True, "rating": 5}, headers=auth_header(startup["token"]))
    assert feedback.status_code == 200
    assert feedback.json() == {"success": True, "new_effectiveness_score": 5.0}
    doc = _matches(fake_mongo).find_one({"_id": match["_id"]})
    assert doc["status"] == "completed"
    assert [h["to"] for h in doc["history"]] == ["met", "completed"]
    # The mentor can still log their side after completion.
    mentor_token = _claim_mentor(client, fake_mongo, mentors[0])
    assert client.post("/health/log", json=body, headers=auth_header(mentor_token)).status_code == 200


# --- migration ----------------------------------------------------------------------------------

def test_migration_maps_statuses_dedupes_pairs_and_is_idempotent(fake_mongo):
    database = db(fake_mongo)
    founder = database["users"].insert_one({"email": "f@s.io", "role": "startup", "profile": {"company": "Volt"}}).inserted_id
    uid = str(founder)
    rows = [
        ("a", "m1", "pending", "2026-09-01T00:00:00+00:00"),
        ("b", "m1", "email_sent", "2026-09-02T00:00:00+00:00"),   # most advanced of m1
        ("c", "m2", "emailed", "2026-09-03T00:00:00+00:00"),
        ("d", "m3", "completed", "2026-09-04T00:00:00+00:00"),
        ("e", "m3", "pending", "2026-09-05T00:00:00+00:00"),
    ]
    for match_id, mentor_id, status, ts in rows:
        database["matches"].insert_one({
            "match_id": match_id, "user_id": uid, "mentor_id": mentor_id, "status": status, "timestamp": ts,
            "profile_fingerprint": match_id, "email_sent_at": ts if status == "email_sent" else None,
            "startup_profile": {"domain": "EV", "stage": "MVP", "challenges": [], "team_gaps": []},
        })
    database["matches"].create_index(
        [("user_id", 1), ("mentor_id", 1), ("profile_fingerprint", 1)], unique=True, name="uniq_user_mentor_profile"
    )

    preview = migrate(database, dry_run=True)
    assert preview["matches_status_pending_to_suggested"] == 2
    assert preview["matches_status_emailed_to_suggested"] == 1
    assert preview["matches_status_email_sent_to_requested"] == 1
    assert preview["startups_created"] == 1 and preview["startup_profiles_created"] == 1
    assert preview["matches_deduplicated"] == 2
    assert preview["old_index_dropped"] == 1
    assert database["matches"].find_one({"match_id": "a"})["status"] == "pending"
    assert database["startups"].count_documents({}) == 0

    first = migrate(database, dry_run=False)
    assert first["startups_created"] == 1 and first["matches_deduplicated"] == 2
    statuses = {d["match_id"]: d for d in database["matches"].find()}
    assert {k: v["status"] for k, v in statuses.items()} == {
        "a": "suggested", "b": "requested", "c": "suggested", "d": "completed", "e": "suggested"
    }
    assert statuses["b"]["requested_at"] == "2026-09-02T00:00:00+00:00"
    assert statuses["b"]["active"] is True and statuses["a"]["duplicate_of"] == "b"
    assert statuses["d"]["active"] is True and statuses["e"]["duplicate_of"] == "d"
    startup = database["startups"].find_one()
    assert startup["company_name"] == "Volt" and all(d["startup_id"] == str(startup["_id"]) for d in statuses.values())
    assert database["startup_profiles"].find_one()["profile"]["domain"] == "EV"
    assert "uniq_user_mentor_profile" not in database["matches"].index_information()

    snapshot = sorted((d["match_id"], d["status"], d.get("active"), d.get("duplicate_of")) for d in database["matches"].find())
    second = migrate(database, dry_run=False)
    assert _changes(second) == 0
    assert sorted((d["match_id"], d["status"], d.get("active"), d.get("duplicate_of")) for d in database["matches"].find()) == snapshot
    assert database["startups"].count_documents({}) == 1 and database["startup_profiles"].count_documents({}) == 1

    # The partial unique pair index can be built on the result: at most one
    # live document per (startup, mentor). (mongomock ignores the partial
    # filter when building over existing data, so this is checked directly;
    # the real index build is covered by the live staging run.)
    live = [(d["startup_id"], d["mentor_id"]) for d in database["matches"].find({"active": True})]
    assert len(live) == len(set(live)) == 3
