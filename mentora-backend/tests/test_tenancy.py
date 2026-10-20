"""Tenancy (Phase 1): organizations, cohorts, invites, cohort scoping and
the migrate_v2 backfill."""
import copy
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.services import tenancy
from scripts.migrate_v2 import _changes, migrate
from tests.conftest import (
    COORDINATOR_PAYLOAD,
    MENTOR_PAYLOAD,
    STARTUP_PAYLOAD,
    auth_header,
    db,
    me,
    register,
    register_coordinator,
    seed_mentor,
)


def _org(slug="acme", cohort="Spring"):
    org = tenancy.get_or_create_org(slug, slug.title())
    cohort_doc = tenancy.get_or_create_cohort(str(org["_id"]), cohort)
    return str(org["_id"]), str(cohort_doc["_id"])


def _coordinator(client, cohort_id, email="lead@acme.org"):
    return register_coordinator(client, {**COORDINATOR_PAYLOAD, "email": email}, cohort_id=cohort_id)


def _invite(client, token, cohort_id, **body):
    return client.post(f"/cohorts/{cohort_id}/invites", json=body, headers=auth_header(token))


def _startup(email, invite_token=None):
    payload = {**STARTUP_PAYLOAD, "email": email}
    if invite_token:
        payload["invite_token"] = invite_token
    return payload


@pytest.fixture
def acme(client):
    org_id, cohort_id = _org()
    return {"org_id": org_id, "cohort_id": cohort_id, "coordinator": _coordinator(client, cohort_id)}


# --- registration rules ----------------------------------------------------------------

def test_coordinator_without_invite_is_403(client, fake_mongo):
    response = client.post("/register", json=COORDINATOR_PAYLOAD)
    assert response.status_code == 403
    assert "invite" in response.json()["error"].lower()
    assert db(fake_mongo)["users"].count_documents({}) == 0


def test_coordinator_with_startup_invite_is_rejected(client, acme):
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup").json()
    response = client.post("/register", json={**COORDINATOR_PAYLOAD, "email": "x@y.org", "invite_token": link["token"]})
    assert response.status_code == 400


def test_startup_without_invite_lands_in_legacy_org(client, fake_mongo):
    user = me(client, register(client, STARTUP_PAYLOAD))
    legacy_org_id, default_cohort_id = tenancy.ensure_legacy_org()
    assert user["org_id"] == legacy_org_id
    assert user["cohort_id"] == default_cohort_id
    assert user["cohort_ids"] == [default_cohort_id]
    assert db(fake_mongo)["organizations"].find_one({"slug": "legacy"})


def test_new_mentor_gets_visibility_defaults(client, fake_mongo):
    user = me(client, register(client, MENTOR_PAYLOAD))
    mentor = db(fake_mongo)["mentors"].find_one({"_id": ObjectId(user["mentor_id"])})
    assert mentor["visibility"]["scope"] == "global"
    assert mentor["listed"] is True and mentor["active"] is True
    assert mentor["user_id"] == user["user_id"]


# --- invite lifecycle ----------------------------------------------------------------------

def test_coordinator_invite_bootstraps_cohort(client, fake_mongo, acme):
    response = client.get("/orgs/me", headers=auth_header(acme["coordinator"]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["org"]["slug"] == "acme"
    assert [c["cohort_id"] for c in body["cohorts"]] == [acme["cohort_id"]]

    user = me(client, acme["coordinator"])
    assert user["role"] == "coordinator" and user["cohort_ids"] == [acme["cohort_id"]]
    cohort = db(fake_mongo)["cohorts"].find_one({"_id": ObjectId(acme["cohort_id"])})
    assert cohort["coordinator_user_ids"] == [user["user_id"]]


def test_startup_link_is_multi_use_and_scoped(client, fake_mongo, acme):
    created = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup")
    assert created.status_code == 201, created.text
    link = created.json()
    assert link["url"].endswith(f"/join/{link['token']}")
    assert link["max_uses"] > 1 and link["uses"] == 0 and link["status"] == "active"

    # Only the hash is stored.
    stored = db(fake_mongo)["invites"].find_one({"_id": ObjectId(link["invite_id"])})
    assert stored["token_hash"] == tenancy.hash_token(link["token"])
    assert link["token"] not in str(stored)

    a = me(client, register(client, _startup("a@startup.io", link["token"])))
    register(client, _startup("b@startup.io", link["token"]))
    assert a["org_id"] == acme["org_id"] and a["cohort_ids"] == [acme["cohort_id"]]

    listed = client.get(f"/cohorts/{acme['cohort_id']}/invites", headers=auth_header(acme["coordinator"])).json()
    startup_link = next(i for i in listed["invites"] if i["invite_id"] == link["invite_id"])
    assert startup_link["uses"] == 2
    assert "token" not in startup_link and "token_hash" not in startup_link

    rows = client.get("/health/cohort", headers=auth_header(acme["coordinator"])).json()["startups"]
    assert sorted(r["email"] for r in rows) == ["a@startup.io", "b@startup.io"]


def test_preview_is_public_and_has_no_secrets(client, acme):
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="mentor", email="Mentor@Acme.org").json()
    response = client.get(f"/invites/{link['token']}")
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "org_name": "Acme",
        "org_slug": "acme",
        "cohort_name": "Spring",
        "role": "mentor",
        "email": "mentor@acme.org",
        "mentor_name": None,
        "expires_at": body["expires_at"],
    }
    assert client.get("/invites/not-a-real-token").status_code == 404


def test_single_use_invite_cannot_be_reused(client, acme):
    invite = _invite(client, acme["coordinator"], acme["cohort_id"], role="coordinator", email="co@acme.org").json()
    payload = {**COORDINATOR_PAYLOAD, "email": "co@acme.org", "invite_token": invite["token"]}
    assert client.post("/register", json=payload).status_code == 200

    again = client.post("/register", json={**payload, "email": "co@acme.org"})
    assert again.status_code == 410
    assert client.get(f"/invites/{invite['token']}").status_code == 410


def test_email_bound_invite_rejects_other_email(client, fake_mongo, acme):
    invite = _invite(client, acme["coordinator"], acme["cohort_id"], role="coordinator", email="co@acme.org").json()
    response = client.post(
        "/register", json={**COORDINATOR_PAYLOAD, "email": "intruder@evil.io", "invite_token": invite["token"]}
    )
    assert response.status_code == 403
    assert db(fake_mongo)["invites"].find_one({"_id": ObjectId(invite["invite_id"])})["uses"] == 0


def test_max_uses_is_enforced(client, acme):
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup", max_uses=1).json()
    assert client.post("/register", json=_startup("one@s.io", link["token"])).status_code == 200
    response = client.post("/register", json=_startup("two@s.io", link["token"]))
    assert response.status_code == 410
    assert "already been used" in response.json()["error"]


def test_expired_invite_is_rejected(client, fake_mongo, acme):
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup").json()
    db(fake_mongo)["invites"].update_one(
        {"_id": ObjectId(link["invite_id"])},
        {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}},
    )
    assert client.get(f"/invites/{link['token']}").status_code == 410
    response = client.post("/register", json=_startup("late@s.io", link["token"]))
    assert response.status_code == 410
    assert "expired" in response.json()["error"]


def test_revoked_invite_is_rejected(client, acme):
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup").json()
    revoked = client.delete(f"/invites/{link['invite_id']}", headers=auth_header(acme["coordinator"]))
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    # Idempotent.
    assert client.delete(f"/invites/{link['invite_id']}", headers=auth_header(acme["coordinator"])).status_code == 200

    assert client.get(f"/invites/{link['token']}").status_code == 410
    response = client.post("/register", json=_startup("x@s.io", link["token"]))
    assert response.status_code == 410
    assert "revoked" in response.json()["error"]


def test_failed_registration_gives_the_use_back(client, fake_mongo, acme):
    register(client, _startup("taken@s.io"))
    link = _invite(client, acme["coordinator"], acme["cohort_id"], role="startup", max_uses=1).json()
    assert client.post("/register", json=_startup("taken@s.io", link["token"])).status_code == 409
    assert db(fake_mongo)["invites"].find_one({"_id": ObjectId(link["invite_id"])})["uses"] == 0
    assert client.post("/register", json=_startup("fresh@s.io", link["token"])).status_code == 200


def test_invite_validation(client, acme):
    token, cohort_id = acme["coordinator"], acme["cohort_id"]
    assert _invite(client, token, cohort_id, role="mentor").status_code == 422
    assert _invite(client, token, cohort_id, role="coordinator").status_code == 422
    assert _invite(client, token, cohort_id, role="startup", mentor_id=str(ObjectId())).status_code == 422
    assert _invite(client, token, cohort_id, role="coordinator", email="a@b.io", max_uses=5).status_code == 422
    assert _invite(client, token, cohort_id, role="mentor", email="a@b.io", mentor_id=str(ObjectId())).status_code == 404


def test_only_coordinators_manage_invites(client, acme):
    startup = register(client, STARTUP_PAYLOAD)
    assert _invite(client, startup, acme["cohort_id"], role="startup").status_code == 403
    assert client.get(f"/cohorts/{acme['cohort_id']}/invites", headers=auth_header(startup)).status_code == 403
    assert client.post(f"/cohorts/{acme['cohort_id']}/invites", json={"role": "startup"}).status_code == 401


# --- mentor claim ---------------------------------------------------------------------------

def test_mentor_invite_claims_seeded_mentor(client, fake_mongo, acme):
    mentor_id = seed_mentor(fake_mongo, name="Ava Chen", email="ava@seed.dev", sector_expertise=["FinTech"])
    invite = _invite(
        client, acme["coordinator"], acme["cohort_id"], role="mentor", email="ava@real.org", mentor_id=mentor_id
    ).json()
    assert client.get(f"/invites/{invite['token']}").json()["mentor_name"] == "Ava Chen"

    mentors_before = db(fake_mongo)["mentors"].count_documents({})
    # No profile needed: the seeded document is claimed.
    token = register(
        client, {"email": "ava@real.org", "password": "correct-horse", "role": "mentor", "invite_token": invite["token"]}
    )
    user = me(client, token)
    assert user["mentor_id"] == mentor_id
    assert user["profile"]["name"] == "Ava Chen"
    assert db(fake_mongo)["mentors"].count_documents({}) == mentors_before

    mentor = db(fake_mongo)["mentors"].find_one({"_id": ObjectId(mentor_id)})
    assert mentor["user_id"] == user["user_id"]
    assert mentor["email"] == "ava@real.org"
    assert mentor["visibility"] == {"scope": "global", "org_ids": [acme["org_id"]]}
    listed = client.get("/mentors", headers=auth_header(acme["coordinator"])).json()["mentors"]
    assert next(m for m in listed if m["mentor_id"] == mentor_id)["claimed"] is True

    # The mentor can now act on it (e.g. onboarding) and it can't be claimed twice.
    again = _invite(
        client, acme["coordinator"], acme["cohort_id"], role="mentor", email="other@real.org", mentor_id=mentor_id
    )
    assert again.status_code == 409


def test_claim_race_loses_cleanly(client, fake_mongo, acme):
    mentor_id = seed_mentor(fake_mongo, name="Ben")
    invite = _invite(
        client, acme["coordinator"], acme["cohort_id"], role="mentor", email="ben@real.org", mentor_id=mentor_id
    ).json()
    # Someone else claims it after the invite was issued.
    db(fake_mongo)["mentors"].update_one({"_id": ObjectId(mentor_id)}, {"$set": {"user_id": "someone"}})
    response = client.post(
        "/register", json={"email": "ben@real.org", "password": "correct-horse", "role": "mentor", "invite_token": invite["token"]}
    )
    assert response.status_code == 409
    assert db(fake_mongo)["users"].count_documents({"email": "ben@real.org"}) == 0
    assert db(fake_mongo)["invites"].find_one({"_id": ObjectId(invite["invite_id"])})["uses"] == 0


# --- cohort scoping ---------------------------------------------------------------------------

def test_coordinator_cannot_see_another_cohort(client, fake_mongo):
    _, cohort_a = _org("alpha", "A")
    _, cohort_b = _org("beta", "B")
    coord_a = _coordinator(client, cohort_a, "a@alpha.org")
    coord_b = _coordinator(client, cohort_b, "b@beta.org")

    link_b = _invite(client, coord_b, cohort_b, role="startup").json()
    startup_b = me(client, register(client, _startup("secret@beta.io", link_b["token"])))
    legacy_startup = me(client, register(client, _startup("legacy@s.io")))

    rows_a = client.get("/health/cohort", headers=auth_header(coord_a)).json()["startups"]
    assert rows_a == []
    rows_b = client.get("/health/cohort", headers=auth_header(coord_b)).json()["startups"]
    assert [r["email"] for r in rows_b] == ["secret@beta.io"]

    assert client.get(f"/health/{startup_b['user_id']}", headers=auth_header(coord_a)).status_code == 403
    assert client.get(f"/health/{legacy_startup['user_id']}", headers=auth_header(coord_a)).status_code == 403
    assert client.get(f"/health/{startup_b['user_id']}", headers=auth_header(coord_b)).status_code == 200

    # Nor manage its invites.
    assert _invite(client, coord_a, cohort_b, role="startup").status_code == 403
    assert client.get(f"/cohorts/{cohort_b}/invites", headers=auth_header(coord_a)).status_code == 403
    assert client.delete(f"/invites/{link_b['invite_id']}", headers=auth_header(coord_a)).status_code == 404
    assert db(fake_mongo)["invites"].find_one({"_id": ObjectId(link_b["invite_id"])})["revoked_at"] is None


def test_role_comes_from_the_database(client, fake_mongo):
    """A demoted coordinator loses access even with a JWT minted earlier."""
    token = register_coordinator(client)
    assert client.get("/health/cohort", headers=auth_header(token)).status_code == 200
    db(fake_mongo)["users"].update_one({"email": COORDINATOR_PAYLOAD["email"]}, {"$set": {"role": "startup"}})
    assert client.get("/health/cohort", headers=auth_header(token)).status_code == 403


def test_pre_tenancy_users_belong_to_legacy_cohort(client, fake_mongo):
    """Users without org fields (pre-migration) show up for legacy coordinators."""
    db(fake_mongo)["users"].insert_one({"email": "old@s.io", "role": "startup"})
    coordinator = register_coordinator(client)
    rows = client.get("/health/cohort", headers=auth_header(coordinator)).json()["startups"]
    assert [r["email"] for r in rows] == ["old@s.io"]


# --- migrate_v2 ------------------------------------------------------------------------------------

def _seed_pre_tenancy(database):
    database["users"].insert_many(
        [
            {"email": "founder@s.io", "role": "startup"},
            {"email": "mentor@m.io", "role": "mentor", "mentor_id": "m1"},
            {"email": "self@c.io", "role": "coordinator"},
            {"email": "Keep@C.io", "role": "coordinator"},
            {"email": "invited@c.io", "role": "coordinator", "invite_id": "i1", "org_id": "o1", "cohort_id": "c1"},
        ]
    )
    database["mentors"].insert_many(
        [{"name": "Seed One"}, {"name": "Seed Two", "listed": False}, {"name": "Seed Three", "visibility": {"scope": "orgs", "org_ids": ["o1"]}}]
    )


def _snapshot(database):
    out = {}
    for name in ("users", "mentors", "organizations", "cohorts"):
        docs = []
        for doc in database[name].find({}, {"created_at": 0, "demoted_at": 0}).sort("_id", 1):
            docs.append(copy.deepcopy(doc))
        out[name] = docs
    return out


def test_migration_dry_run_writes_nothing(fake_mongo):
    database = db(fake_mongo)
    _seed_pre_tenancy(database)
    before = _snapshot(database)

    report = migrate(database, dry_run=True, keep_coordinators=["keep@c.io"])
    assert _snapshot(database) == before
    assert report["legacy_org"] == "would_create"
    assert report["users_backfilled"] == 4
    assert report["users_cohort_ids_backfilled"] == 1
    assert report["coordinators_demoted"] == 1
    assert report["coordinator_emails_demoted"] == ["self@c.io"]
    assert report["coordinators_kept"] == 1
    assert report["mentors_visibility_backfilled"] == 2
    assert report["mentors_listed_backfilled"] == 2
    assert report["mentors_active_backfilled"] == 3


def test_migration_is_idempotent(fake_mongo):
    database = db(fake_mongo)
    _seed_pre_tenancy(database)

    first = migrate(database, dry_run=False, keep_coordinators=["keep@c.io"])
    assert first["legacy_org"] == "created" and first["default_cohort"] == "created"
    after_first = _snapshot(database)

    second = migrate(database, dry_run=False, keep_coordinators=["keep@c.io"])
    assert _changes(second) == 0
    assert second["legacy_org"] == "exists" and second["default_cohort"] == "exists"
    assert _snapshot(database) == after_first
    assert _changes(migrate(database, dry_run=True, keep_coordinators=["keep@c.io"])) == 0

    org = database["organizations"].find_one({"slug": "legacy"})
    cohort = database["cohorts"].find_one({"org_id": str(org["_id"]), "name": "default"})
    cid = str(cohort["_id"])
    users = {u["email"]: u for u in database["users"].find()}
    assert users["founder@s.io"]["cohort_ids"] == [cid]
    assert users["self@c.io"]["role"] == "startup" and users["self@c.io"]["demoted_from"] == "coordinator"
    assert users["Keep@C.io"]["role"] == "coordinator"
    assert users["invited@c.io"]["role"] == "coordinator" and users["invited@c.io"]["cohort_ids"] == ["c1"]
    assert cohort["coordinator_user_ids"] == [str(users["Keep@C.io"]["_id"])]

    mentors = {m["name"]: m for m in database["mentors"].find()}
    assert mentors["Seed One"]["visibility"] == {"scope": "global", "org_ids": []}
    assert mentors["Seed Two"]["listed"] is False
    assert mentors["Seed Three"]["visibility"]["scope"] == "orgs"
    assert all(m["active"] is True for m in mentors.values())


def test_migrated_users_keep_working(client, fake_mongo):
    """After the migration, legacy users still authenticate and are scoped
    into the legacy default cohort."""
    token = register(client, STARTUP_PAYLOAD)
    database = db(fake_mongo)
    database["users"].update_one({"email": STARTUP_PAYLOAD["email"]}, {"$unset": {"org_id": "", "cohort_id": "", "cohort_ids": ""}})
    migrate(database, dry_run=False, keep_coordinators=[])
    user = me(client, token)
    assert user["cohort_ids"] == [tenancy.ensure_legacy_org()[1]]
    coordinator = register_coordinator(client)
    rows = client.get("/health/cohort", headers=auth_header(coordinator)).json()["startups"]
    assert [r["email"] for r in rows] == [STARTUP_PAYLOAD["email"]]
