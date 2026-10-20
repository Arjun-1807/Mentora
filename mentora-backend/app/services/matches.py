"""
Match records (the `matches` collection): identity, lifecycle, enrichment.

Identity
--------
A match is keyed on the pair `(startup_id, mentor_id)`. Exactly one document
per pair is *live* (`active: true`, enforced by the partial unique index
`uniq_active_startup_mentor`). A new deck therefore refreshes the existing
pair's score / `profile_id` / `startup_profile` snapshot instead of creating
new documents, so a match the mentor already accepted stays actionable.
Suggestions that drop out of the new top 5 while still `suggested` become
`superseded` (inactive). Documents also carry `user_id` (the owning startup
user, used for ownership checks), `org_id`, `cohort_id`, `history[]` and,
for replacement suggestions, `replacement_for` (the match_id they replace).

Lifecycle (see TRANSITIONS)
---------------------------
    suggested --startup requests--> requested --mentor--> accepted --book--> meeting_scheduled
        |                               |                                      |      \\
        | system (new deck)             +--mentor--> declined                  |       met
        v                               +--startup-> withdrawn                 v      /
    superseded --system (back in top 5)--> suggested                          completed
                                        +--system (7 days)--> expired

`transition_match()` is the only writer of `status`: it checks the table,
updates atomically (the filter includes the status it read) and appends a
`history` entry `{from, to, by_role, by_user_id, at}`. Reaching declined /
withdrawn / expired adds a replacement suggestion. `advance_match_status()`
is kept as a backward-compatible wrapper.

Legacy statuses map as pending/emailed -> suggested and email_sent ->
requested (scripts/migrate_v2.py rewrites them; reads normalise them too).
"""
import hashlib
import json
import logging
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence
from uuid import uuid4

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.config import settings
from app.db.mongo import get_matches_collection, get_mentors_collection, get_users_collection
from app.models.schemas import MentorMatch, StartupProfile

logger = logging.getLogger(__name__)

# --- vocabulary ------------------------------------------------------------------

SUGGESTED = "suggested"
REQUESTED = "requested"
ACCEPTED = "accepted"
DECLINED = "declined"
WITHDRAWN = "withdrawn"
EXPIRED = "expired"
MEETING_SCHEDULED = "meeting_scheduled"
MET = "met"
COMPLETED = "completed"
SUPERSEDED = "superseded"

# The forward ("happy path") order; index == lifecycle position.
MATCH_STATUS_ORDER: List[str] = [SUGGESTED, REQUESTED, ACCEPTED, MEETING_SCHEDULED, MET, COMPLETED]
TERMINAL_STATUSES: List[str] = [DECLINED, WITHDRAWN, EXPIRED]
MATCH_STATUSES: List[str] = MATCH_STATUS_ORDER + TERMINAL_STATUSES + [SUPERSEDED]
# Statuses whose document is no longer the live record of its pair.
INACTIVE_STATUSES: List[str] = TERMINAL_STATUSES + [SUPERSEDED]

LEGACY_STATUS_MAP: Dict[str, str] = {"pending": SUGGESTED, "emailed": SUGGESTED, "email_sent": REQUESTED}
# Kept for importers of the old name (terminal side-branch set by the mentor).
DECLINED_STATUS = DECLINED

# Actor roles.
STARTUP = "startup"
MENTOR = "mentor"
SYSTEM = "system"

# from -> {to -> roles allowed to make that move}
TRANSITIONS: Dict[str, Dict[str, frozenset]] = {
    SUGGESTED: {REQUESTED: frozenset({STARTUP}), SUPERSEDED: frozenset({SYSTEM})},
    REQUESTED: {
        ACCEPTED: frozenset({MENTOR}),
        DECLINED: frozenset({MENTOR}),
        WITHDRAWN: frozenset({STARTUP}),
        EXPIRED: frozenset({SYSTEM}),
    },
    ACCEPTED: {MEETING_SCHEDULED: frozenset({STARTUP})},
    MEETING_SCHEDULED: {
        MET: frozenset({STARTUP, MENTOR, SYSTEM}),
        COMPLETED: frozenset({STARTUP, MENTOR, SYSTEM}),
    },
    MET: {COMPLETED: frozenset({STARTUP, MENTOR, SYSTEM})},
    SUPERSEDED: {SUGGESTED: frozenset({SYSTEM})},
}

# --- status groups shared by stats, listings and access checks --------------------

REQUEST_STATUSES: List[str] = [REQUESTED]  # waiting for the mentor
ACCEPTED_STATUSES: List[str] = [ACCEPTED, MEETING_SCHEDULED, MET, COMPLETED]
MEETING_STATUSES: List[str] = [MEETING_SCHEDULED, MET, COMPLETED]
# Everything a mentor may see: an intro was actually sent.
REQUESTED_OR_LATER: List[str] = [REQUESTED, ACCEPTED, DECLINED, WITHDRAWN, EXPIRED, MEETING_SCHEDULED, MET, COMPLETED]
EMAIL_SENT_OR_LATER: List[str] = REQUESTED_OR_LATER
# The startup's contact email is only shown to the mentor from here on.
STARTUP_EMAIL_VISIBLE: List[str] = ACCEPTED_STATUSES
# Feedback / outcomes need a meeting.
OUTCOME_STATUSES: List[str] = [MEETING_SCHEDULED, MET, COMPLETED]


def normalise_status(raw: Optional[str]) -> str:
    if not raw:
        return SUGGESTED
    raw = str(raw)
    return LEGACY_STATUS_MAP.get(raw, raw)


def stored_statuses(statuses: Iterable[str]) -> List[str]:
    """`statuses` plus the legacy spellings that normalise to them (for queries)."""
    wanted = list(dict.fromkeys(statuses))
    for legacy, new in LEGACY_STATUS_MAP.items():
        if new in wanted and legacy not in wanted:
            wanted.append(legacy)
    return wanted


def status_in(statuses: Iterable[str]) -> Dict[str, Any]:
    return {"$in": stored_statuses(statuses)}


# Statuses that occupy a mentor's monthly capacity (mentor_matching's
# capacity filter): the startup actually sent a request, and the engagement
# is not finished yet. Query with `status_in()` so legacy `email_sent` counts.
CAPACITY_LOAD_STATUSES: List[str] = [REQUESTED, ACCEPTED, MEETING_SCHEDULED]


# Documents that should appear in listings / counts: not superseded and not a
# de-duplicated legacy copy of another match.
VISIBLE_FILTER: Dict[str, Any] = {"status": {"$ne": SUPERSEDED}, "duplicate_of": {"$exists": False}}


def now_utc() -> datetime:
    """The service clock (tests monkeypatch this)."""
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return now_utc().isoformat()


def parse_ts(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    return None


def profile_fingerprint(profile: StartupProfile) -> str:
    """Stable short hash of a startup profile (order/case-insensitive)."""
    data = {
        "domain": (profile.domain or "").strip().lower(),
        "stage": (profile.stage or "").strip().lower(),
        "challenges": sorted(c.strip().lower() for c in profile.challenges or []),
        "team_gaps": sorted(g.strip().lower() for g in profile.team_gaps or []),
        "geography": (profile.geography or "").strip().lower(),
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


def _oid(raw: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except (InvalidId, TypeError):
        return None


def find_match(match_id: Any) -> Optional[Dict[str, Any]]:
    """Look a match up by its uuid `match_id`, falling back to the Mongo `_id`."""
    if not match_id:
        return None
    matches = get_matches_collection()
    doc = matches.find_one({"match_id": str(match_id)})
    if doc is None:
        oid = _oid(match_id)
        if oid is not None:
            doc = matches.find_one({"_id": oid})
    return doc


# --- state machine -----------------------------------------------------------------

class TransitionError(Exception):
    """A requested status change is not allowed (409) or the match is gone (404)."""

    def __init__(self, message: str, status_code: int = 409, current: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.current = current


def can_transition(current: str, to: str, actor_role: str) -> bool:
    return actor_role in TRANSITIONS.get(normalise_status(current), {}).get(to, frozenset())


def _active_field(doc: Dict[str, Any], to: str) -> Dict[str, Any]:
    """`active` for a doc moving to `to`. Only pair-keyed docs (with a
    startup_id) carry the flag; legacy docs are left alone until adopted."""
    if not doc.get("startup_id"):
        return {}
    return {"active": to not in INACTIVE_STATUSES and not doc.get("duplicate_of")}


def transition_match(
    match_id: Any,
    actor_role: str,
    actor_user_id: Optional[str],
    to: str,
    extra_set: Optional[Dict[str, Any]] = None,
    *,
    doc: Optional[Dict[str, Any]] = None,
    side_effects: bool = True,
) -> Dict[str, Any]:
    """Move one match to `to` if TRANSITIONS allows it for `actor_role`.

    The update is a single `find_one_and_update` whose filter includes the
    status that was read, so two concurrent writers cannot both win; it sets
    `status`, `status_updated_at`, `active`, any `extra_set` fields, and
    pushes a history entry. Returns the updated document.

    Raises TransitionError (404 unknown match, 409 not allowed / lost race).
    Ownership is the caller's job. With `side_effects`, reaching a terminal
    status adds a replacement suggestion (best effort).
    """
    if to not in MATCH_STATUSES:
        raise ValueError(f"Unknown match status: {to!r}")
    matches = get_matches_collection()
    for attempt in range(3):
        current_doc = doc if (doc is not None and attempt == 0) else find_match(match_id)
        if current_doc is None:
            raise TransitionError("Match not found.", 404)
        raw = current_doc.get("status")
        current = normalise_status(raw)
        if not can_transition(current, to, actor_role):
            raise TransitionError(
                f"This match is {current.replace('_', ' ')}; it cannot move to {to.replace('_', ' ')}.",
                409,
                current,
            )
        now = _iso_now()
        fields: Dict[str, Any] = {
            "status": to,
            "status_updated_at": now,
            "updated_at": now,
            **_active_field(current_doc, to),
            **(extra_set or {}),
        }
        entry = {"from": current, "to": to, "by_role": actor_role, "by_user_id": actor_user_id, "at": now}
        updated = matches.find_one_and_update(
            {"_id": current_doc["_id"], "status": raw},
            {"$set": fields, "$push": {"history": entry}},
            return_document=ReturnDocument.AFTER,
        )
        if updated is not None:
            if side_effects and to in TERMINAL_STATUSES:
                try:
                    ensure_replacement(updated)
                except Exception:
                    logger.exception("Failed to add a replacement for match %s", updated.get("match_id"))
            return updated
    raise TransitionError("The match changed while it was being updated. Please try again.", 409)


def _forward_reachable(current: str) -> List[str]:
    seen, queue = [], deque([current])
    while queue:
        node = queue.popleft()
        for nxt in TRANSITIONS.get(node, {}):
            if nxt not in seen and nxt != current:
                seen.append(nxt)
                queue.append(nxt)
    return seen


def advance_match_status(match_id: Optional[str], user_id: str, new_status: str) -> bool:
    """Backward-compatible wrapper: move one of `user_id`'s matches forwards.

    Accepts the legacy vocabulary (emailed / email_sent / ...). Returns True
    only if the status changed; never regresses (the target must be reachable
    from the current status in TRANSITIONS) and never raises for a match that
    is missing, foreign or already at/after the target.
    """
    if not match_id:
        return False
    target = normalise_status(new_status)
    if target not in MATCH_STATUSES:
        raise ValueError(f"Unknown match status: {new_status!r}")
    try:
        doc = get_matches_collection().find_one({"match_id": match_id, "user_id": user_id})
        if doc is None:
            return False
        raw = doc.get("status")
        current = normalise_status(raw)
        if target == current or target not in _forward_reachable(current):
            return False
        now = _iso_now()
        fields = {
            "status": target,
            "status_updated_at": now,
            "updated_at": now,
            **_active_field(doc, target),
        }
        if target == REQUESTED:
            fields["requested_at"] = now
            fields["email_sent_at"] = now
        result = get_matches_collection().update_one(
            {"_id": doc["_id"], "status": raw},
            {
                "$set": fields,
                "$push": {"history": {"from": current, "to": target, "by_role": SYSTEM, "by_user_id": user_id, "at": now}},
            },
        )
    except Exception:
        logger.exception("Failed to advance match %s to status %r", match_id, new_status)
        return False
    return result.modified_count > 0


# --- creating / refreshing suggestions ---------------------------------------------------

def _context(startup: Dict[str, Any], profile_doc: Optional[Dict[str, Any]], profile: StartupProfile) -> Dict[str, Any]:
    return {
        "startup_id": str(startup["_id"]),
        "user_id": str(startup.get("owner_user_id") or ""),
        "org_id": startup.get("org_id"),
        "cohort_id": startup.get("cohort_id"),
        "profile_id": str(profile_doc["_id"]) if profile_doc else None,
        "startup_profile": profile.model_dump(),
        "profile_fingerprint": profile_fingerprint(profile),
    }


def _pair_fields(ctx: Dict[str, Any], match: MentorMatch, now: str) -> Dict[str, Any]:
    return {
        "user_id": ctx["user_id"],
        "org_id": ctx["org_id"],
        "cohort_id": ctx["cohort_id"],
        "profile_id": ctx["profile_id"],
        "startup_profile": ctx["startup_profile"],
        "profile_fingerprint": ctx["profile_fingerprint"],
        "score": match.match_score,
        "mentor_name": match.name,
        "mentor_email": match.email,
        "updated_at": now,
    }


def upsert_suggestion(
    ctx: Dict[str, Any], match: MentorMatch, replacement_for: Optional[str] = None
) -> Dict[str, Any]:
    """Refresh the live match of (startup, mentor), revive a superseded one,
    or insert a new `suggested` match. Returns the resulting document."""
    matches = get_matches_collection()
    key = {"startup_id": ctx["startup_id"], "mentor_id": match.mentor_id}
    for _ in range(3):
        now = _iso_now()
        fields = _pair_fields(ctx, match, now)
        live = matches.find_one_and_update(
            {**key, "active": True}, {"$set": fields}, return_document=ReturnDocument.AFTER
        )
        if live is not None:
            return live

        superseded = matches.find_one({**key, "status": SUPERSEDED, "duplicate_of": {"$exists": False}})
        if superseded is not None:
            extra = dict(fields)
            if replacement_for:
                extra["replacement_for"] = replacement_for
            try:
                return transition_match(
                    superseded["match_id"], SYSTEM, None, SUGGESTED, extra, doc=superseded, side_effects=False
                )
            except (TransitionError, DuplicateKeyError):
                continue

        doc = {
            **key,
            **fields,
            "match_id": str(uuid4()),
            "status": SUGGESTED,
            "active": True,
            "timestamp": now,
            "history": [{"from": None, "to": SUGGESTED, "by_role": SYSTEM, "by_user_id": None, "at": now}],
        }
        if replacement_for:
            doc["replacement_for"] = replacement_for
        try:
            doc["_id"] = matches.insert_one(dict(doc)).inserted_id
            return doc
        except DuplicateKeyError:
            continue  # a concurrent /match created the live doc; refresh it
    raise RuntimeError(f"Could not record match for mentor {match.mentor_id}")


def terminal_mentor_ids(startup_id: str) -> List[str]:
    """Mentors this startup must not be re-suggested (declined / withdrawn / expired)."""
    return [
        m for m in get_matches_collection().distinct(
            "mentor_id", {"startup_id": startup_id, "status": {"$in": TERMINAL_STATUSES}}
        ) if m
    ]


def sync_matches(
    startup: Dict[str, Any],
    profile_doc: Optional[Dict[str, Any]],
    profile: StartupProfile,
    ranked: Sequence[MentorMatch],
) -> List[Dict[str, Any]]:
    """Record a fresh top-N for a startup (POST /match).

    Each ranked mentor's pair is refreshed / revived / created and the
    MentorMatch is stamped with `match_id` and `status` in place. Live
    `suggested` matches of mentors no longer in the list become superseded.
    """
    ctx = _context(startup, profile_doc, profile)
    docs: List[Dict[str, Any]] = []
    for match in ranked:
        doc = upsert_suggestion(ctx, match)
        match.match_id = doc.get("match_id")
        match.status = normalise_status(doc.get("status"))
        match.replacement_for = doc.get("replacement_for")
        docs.append(doc)

    if ranked:
        keep = [m.mentor_id for m in ranked]
        stale = get_matches_collection().find(
            {
                "startup_id": ctx["startup_id"],
                "active": True,
                "status": status_in([SUGGESTED]),
                "mentor_id": {"$nin": keep},
            }
        )
        for doc in list(stale):
            try:
                transition_match(doc["match_id"], SYSTEM, None, SUPERSEDED, doc=doc, side_effects=False)
            except TransitionError:
                continue
    return docs


def ensure_replacement(original: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """After `original` was declined / withdrawn / expired, suggest the best
    mentor this startup has no non-superseded match with. Idempotent."""
    from app.services import mentor_matching
    from app.services import startups as startup_service

    startup_id = original.get("startup_id")
    if not startup_id or not original.get("match_id"):
        return None
    matches = get_matches_collection()
    existing = matches.find_one({"replacement_for": original["match_id"]})
    if existing is not None:
        return existing

    startup = startup_service.get_startup(startup_id)
    if startup is None:
        return None
    profile_doc = startup_service.get_active_profile(startup)
    raw_profile = (profile_doc or {}).get("profile") or original.get("startup_profile")
    try:
        profile = StartupProfile.model_validate(raw_profile or {})
    except Exception:
        logger.warning("No usable profile to find a replacement for match %s", original["match_id"])
        return None

    exclude = [
        m for m in matches.distinct("mentor_id", {"startup_id": startup_id, "status": {"$ne": SUPERSEDED}}) if m
    ]
    candidates = mentor_matching.find_matching_mentors(profile, exclude_mentor_ids=exclude)
    if not candidates:
        return None
    ctx = _context(startup, profile_doc, profile)
    return upsert_suggestion(ctx, candidates[0], replacement_for=original["match_id"])


# --- lazy expiry ------------------------------------------------------------------------

def expire_stale_requests(scope: Dict[str, Any]) -> int:
    """Expire `requested` matches in `scope` older than MATCH_REQUEST_TTL_DAYS.

    There is no scheduler: list endpoints call this before reading. Each
    expiry goes through transition_match (so it adds a replacement).
    """
    cutoff = now_utc() - timedelta(days=settings.MATCH_REQUEST_TTL_DAYS)
    expired = 0
    try:
        candidates = list(get_matches_collection().find({**scope, "status": status_in([REQUESTED])}))
    except Exception:
        logger.exception("Failed to look for stale requests")
        return 0
    for doc in candidates:
        sent = parse_ts(
            doc.get("requested_at") or doc.get("email_sent_at") or doc.get("status_updated_at") or doc.get("timestamp")
        )
        if sent is None or sent > cutoff:
            continue
        try:
            transition_match(doc.get("match_id") or doc["_id"], SYSTEM, None, EXPIRED, doc=doc)
            expired += 1
        except TransitionError:
            continue
        except Exception:
            logger.exception("Failed to expire match %s", doc.get("match_id"))
    return expired


# --- legacy adoption (migration + lazy) -----------------------------------------------------

_ADVANCE_RANK = {
    SUPERSEDED: -1,
    SUGGESTED: 0,
    REQUESTED: 1,
    EXPIRED: 2,
    WITHDRAWN: 2,
    DECLINED: 3,
    ACCEPTED: 4,
    MEETING_SCHEDULED: 5,
    MET: 6,
    COMPLETED: 7,
}


def _advance_key(doc: Dict[str, Any]):
    ts = parse_ts(doc.get("updated_at") or doc.get("status_updated_at") or doc.get("timestamp"))
    return (_ADVANCE_RANK.get(normalise_status(doc.get("status")), 0), ts or datetime.min.replace(tzinfo=timezone.utc))


def adopt_legacy_matches(
    user_id: str,
    startup_id: str,
    *,
    org_id: Optional[str] = None,
    cohort_id: Optional[str] = None,
    profile_id: Optional[str] = None,
    matches=None,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Bring one startup user's match docs onto the pair model. Idempotent.

    Stamps `startup_id` (and org/cohort/profile ids where missing), maps
    legacy statuses, and per mentor keeps the most advanced document live
    (`active` per its status); the others become `active: false` with
    `duplicate_of` = the kept match_id. Returns change counts.
    """
    matches = matches if matches is not None else get_matches_collection()
    counts = {"adopted": 0, "statuses_mapped": 0, "duplicates": 0}
    docs = list(matches.find({"user_id": str(user_id)}))
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for doc in docs:
        if doc.get("startup_id") and doc.get("startup_id") != startup_id:
            continue  # belongs to another startup record
        groups.setdefault(str(doc.get("mentor_id") or ""), []).append(doc)

    now = _iso_now()
    for group in groups.values():
        candidates = [d for d in group if not d.get("duplicate_of")]
        if not candidates:
            continue
        winner = max(candidates, key=_advance_key)
        for doc in group:
            status = normalise_status(doc.get("status"))
            is_winner = doc is winner
            fields: Dict[str, Any] = {}
            if not doc.get("startup_id"):
                fields["startup_id"] = startup_id
                counts["adopted"] += 1
            for key, value in (("org_id", org_id), ("cohort_id", cohort_id), ("profile_id", profile_id)):
                if value and not doc.get(key):
                    fields[key] = value
            if doc.get("status") != status:
                fields["status"] = status
                counts["statuses_mapped"] += 1
                if status == REQUESTED and not doc.get("requested_at"):
                    fields["requested_at"] = doc.get("email_sent_at") or doc.get("status_updated_at") or doc.get("timestamp") or now
            if not doc.get("match_id"):
                fields["match_id"] = str(uuid4())
            if is_winner:
                active = status not in INACTIVE_STATUSES
                if doc.get("active") is not active:
                    fields["active"] = active
            elif not doc.get("duplicate_of"):
                fields["active"] = False
                fields["duplicate_of"] = winner.get("match_id") or fields.get("match_id")
                counts["duplicates"] += 1
            if not doc.get("history"):
                fields["history"] = [{"from": None, "to": status, "by_role": "migration", "by_user_id": None, "at": now}]
            if fields and not dry_run:
                matches.update_one({"_id": doc["_id"]}, {"$set": fields})
                doc.update(fields)
    return counts


# --- enrichment / serialisation -------------------------------------------------------------

def jsonable(doc: Dict[str, Any]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            clean[key] = str(value)
        elif isinstance(value, datetime):
            clean[key] = value.isoformat()
        else:
            clean[key] = value
    return clean


def _object_ids(raw_ids: Iterable[Any]) -> List[ObjectId]:
    out: List[ObjectId] = []
    for raw in raw_ids:
        oid = _oid(raw)
        if oid is not None and oid not in out:
            out.append(oid)
    return out


_MENTOR_DETAIL_FIELDS = ("name", "domain", "stage_focus", "expertise", "geography", "email")


def enrich_match_docs(
    docs: List[Dict[str, Any]],
    include_startup_email: bool = False,
    include_mentor_details: bool = False,
) -> List[Dict[str, Any]]:
    """Backfill display fields on (already JSON-safe) match documents.

    * `status` is normalised (legacy spellings -> lifecycle vocabulary).
    * `mentor_name` from the mentors collection when not stored.
    * with `include_mentor_details`: `name`, `domain`, `stage_focus`,
      `expertise`, `geography`, `email`, `match_score` (the MentorMatch shape
      the /matches cards use) and `replacement_for_name`.
    * with `include_startup_email`: `startup_email` from the users collection.

    Lookups are batched and failures tolerated.
    """
    for doc in docs:
        doc["status"] = normalise_status(doc.get("status"))

    wanted = [d.get("mentor_id") for d in docs if include_mentor_details or not d.get("mentor_name")]
    mentors: Dict[str, Dict[str, Any]] = {}
    oids = _object_ids(wanted)
    if oids:
        try:
            projection = {field: 1 for field in _MENTOR_DETAIL_FIELDS}
            for mentor in get_mentors_collection().find({"_id": {"$in": oids}}, projection):
                mentors[str(mentor["_id"])] = mentor
        except Exception:
            logger.exception("Failed to load mentor details for match listing")

    emails: Dict[str, Optional[str]] = {}
    if include_startup_email:
        user_oids = _object_ids(doc.get("user_id") for doc in docs)
        if user_oids:
            try:
                for user in get_users_collection().find({"_id": {"$in": user_oids}}, {"email": 1}):
                    emails[str(user["_id"])] = user.get("email")
            except Exception:
                logger.exception("Failed to look up startup emails for match listing")

    replaced: Dict[str, Optional[str]] = {}
    if include_mentor_details:
        ids = [d["replacement_for"] for d in docs if d.get("replacement_for")]
        if ids:
            try:
                for original in get_matches_collection().find({"match_id": {"$in": ids}}, {"match_id": 1, "mentor_name": 1, "mentor_id": 1}):
                    replaced[original["match_id"]] = original.get("mentor_name")
            except Exception:
                logger.exception("Failed to look up replaced matches")

    for doc in docs:
        mentor = mentors.get(str(doc.get("mentor_id") or ""), {})
        if not doc.get("mentor_name"):
            doc["mentor_name"] = mentor.get("name")
        if include_mentor_details:
            doc["name"] = doc.get("mentor_name") or mentor.get("name") or "Mentor"
            doc["domain"] = mentor.get("domain") or doc.get("domain")
            doc["stage_focus"] = mentor.get("stage_focus") or doc.get("stage_focus")
            doc["expertise"] = mentor.get("expertise") or doc.get("expertise") or []
            doc["geography"] = mentor.get("geography") or doc.get("geography")
            doc["email"] = mentor.get("email") or doc.get("mentor_email")
            doc["match_score"] = doc.get("score")
            if doc.get("replacement_for"):
                doc["replacement_for_name"] = replaced.get(doc["replacement_for"])
        if include_startup_email:
            doc["startup_email"] = emails.get(str(doc.get("user_id") or ""))
    return docs


_HIDDEN_FROM_MENTOR = ("request_lock", "profile_fingerprint", "mentor_email", "org_id", "cohort_id", "duplicate_of")


def mentor_view(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Mentor-facing match docs: company name + profile summary always,
    the startup's email only once the mentor has accepted."""
    from app.services.startups import company_names

    docs = enrich_match_docs([jsonable(d) for d in docs], include_startup_email=True)
    names = company_names(d.get("startup_id") for d in docs)
    out = []
    for doc in docs:
        for key in _HIDDEN_FROM_MENTOR:
            doc.pop(key, None)
        if doc["status"] not in STARTUP_EMAIL_VISIBLE:
            doc["startup_email"] = None
        profile = doc.get("startup_profile") or {}
        doc["company_name"] = names.get(str(doc.get("startup_id") or "")) or None
        doc["startup_summary"] = {
            "domain": profile.get("domain"),
            "stage": profile.get("stage"),
            "challenges": profile.get("challenges") or [],
            "team_gaps": profile.get("team_gaps") or [],
            "geography": profile.get("geography"),
        }
        doc["history"] = [
            {k: v for k, v in entry.items() if k != "by_user_id"} for entry in doc.get("history") or []
        ]
        out.append(doc)
    return out
