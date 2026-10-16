"""
Persistence helpers for match records (the `matches` collection).

Two concerns live here:

1. **De-duplication.** POST /match used to insert five fresh documents on
   every call, so re-matching the same deck duplicated history and
   double-counted dashboard stats. Match records are now upserted on the
   natural key `(user_id, mentor_id, profile_fingerprint)`, where the
   fingerprint is a stable hash of the startup profile. Re-running /match
   with the same profile therefore refreshes the score of the existing
   records (and preserves their `match_id` and `status`) instead of
   creating new ones.

2. **Status lifecycle.** `pending` -> `emailed` -> `email_sent` ->
   `accepted` -> `meeting_scheduled` -> `completed`, advanced only
   forwards (see `advance_match_status`). `emailed` means a draft was
   generated; `email_sent` means it was actually delivered (the match then
   also carries `email_sent_at`); `accepted` is set by the mentor;
   `meeting_scheduled` by POST /calendar/book (the match then carries a
   `meeting` object); `completed` by POST /feedback. `declined` is a
   terminal side-branch set by the mentor and is never advanced from.

3. **Enrichment.** `enrich_match_docs` backfills `mentor_name` (legacy
   documents predate it) and, for mentor-facing listings, `startup_email`.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument

from app.db.mongo import get_matches_collection, get_mentors_collection, get_users_collection
from app.models.schemas import MentorMatch, StartupProfile

logger = logging.getLogger(__name__)

# Ordered status vocabulary; index == lifecycle position.
MATCH_STATUS_ORDER: List[str] = [
    "pending",
    "emailed",
    "email_sent",
    "accepted",
    "meeting_scheduled",
    "completed",
]
# Terminal side-branch (mentor declined); not part of the forward order.
DECLINED_STATUS = "declined"

# Status groups shared by the stats endpoints and the mentor views.
REQUEST_STATUSES: List[str] = ["pending", "emailed", "email_sent"]
ACCEPTED_STATUSES: List[str] = ["accepted", "meeting_scheduled", "completed"]
MEETING_STATUSES: List[str] = ["meeting_scheduled", "completed"]
EMAIL_SENT_OR_LATER: List[str] = MATCH_STATUS_ORDER[MATCH_STATUS_ORDER.index("email_sent"):]
# Statuses that occupy a mentor's monthly capacity (mentor_matching's
# capacity filter): the startup actually reached out ("requested") or
# later, but the engagement is not finished. The single place to update
# when the lifecycle is renamed (suggested/requested/... in Phase 2).
CAPACITY_LOAD_STATUSES: List[str] = ["email_sent", "accepted", "meeting_scheduled"]


def profile_fingerprint(profile: StartupProfile) -> str:
    """Stable short hash of a startup profile, used as a de-dup key.

    Lists are sorted and strings normalised so that a semantically
    identical profile always produces the same fingerprint.
    """
    data = {
        "domain": (profile.domain or "").strip().lower(),
        "stage": (profile.stage or "").strip().lower(),
        "challenges": sorted(c.strip().lower() for c in profile.challenges or []),
        "team_gaps": sorted(g.strip().lower() for g in profile.team_gaps or []),
        "geography": (profile.geography or "").strip().lower(),
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


def record_matches(
    user_id: str,
    profile: StartupProfile,
    matches: Iterable[MentorMatch],
) -> None:
    """Upsert one match record per mentor and stamp each MentorMatch with
    the resulting `match_id` (mutates the passed-in models in place).

    Failures are logged, never raised: a failure to record history should
    not fail the user's match request.
    """
    collection = get_matches_collection()
    fingerprint = profile_fingerprint(profile)
    profile_dict = profile.model_dump()
    now = datetime.now(timezone.utc).isoformat()

    for match in matches:
        key = {
            "user_id": user_id,
            "mentor_id": match.mentor_id,
            "profile_fingerprint": fingerprint,
        }
        try:
            doc = collection.find_one_and_update(
                key,
                {
                    "$set": {
                        "startup_profile": profile_dict,
                        "score": match.match_score,
                        "mentor_name": match.name,
                        "mentor_email": match.email,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "match_id": str(uuid4()),
                        "status": "pending",
                        "timestamp": now,
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            if doc:
                match.match_id = doc.get("match_id")
        except Exception:
            logger.exception(
                "Failed to record match document (user_id=%s, mentor_id=%s)",
                user_id,
                match.mentor_id,
            )


def advance_match_status(match_id: Optional[str], user_id: str, new_status: str) -> bool:
    """Move a match forwards in the lifecycle. Returns True if it changed.

    Only advances (never regresses) the status, and only for a match owned
    by `user_id`, so this is safe to call opportunistically.
    """
    if not match_id:
        return False
    if new_status not in MATCH_STATUS_ORDER:
        raise ValueError(f"Unknown match status: {new_status!r}")

    earlier = MATCH_STATUS_ORDER[: MATCH_STATUS_ORDER.index(new_status)]
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": new_status, "status_updated_at": now}
    if new_status == "email_sent":
        update["email_sent_at"] = now
    try:
        result = get_matches_collection().update_one(
            {"match_id": match_id, "user_id": user_id, "status": {"$in": earlier}},
            {"$set": update},
        )
    except Exception:
        logger.exception("Failed to advance match %s to status %r", match_id, new_status)
        return False

    return result.modified_count > 0


def _object_ids(raw_ids: Iterable[Any]) -> List[ObjectId]:
    out: List[ObjectId] = []
    for raw in raw_ids:
        try:
            oid = ObjectId(str(raw))
        except (InvalidId, TypeError):
            continue
        if oid not in out:
            out.append(oid)
    return out


def enrich_match_docs(docs: List[Dict[str, Any]], include_startup_email: bool = False) -> List[Dict[str, Any]]:
    """Backfill display fields on (already JSON-safe) match documents.

    * `mentor_name` - looked up from the mentors collection for documents
      that predate it being stored by /match (None if the mentor is gone).
    * `startup_email` - with `include_startup_email`, looked up from the
      users collection via the match's `user_id`.

    Lookups are batched (one query per collection) and failures are logged
    and tolerated: missing display data must not fail a listing.
    """
    missing_names = [doc.get("mentor_id") for doc in docs if not doc.get("mentor_name")]
    names: Dict[str, Optional[str]] = {}
    mentor_oids = _object_ids(missing_names)
    if mentor_oids:
        try:
            for mentor in get_mentors_collection().find({"_id": {"$in": mentor_oids}}, {"name": 1}):
                names[str(mentor["_id"])] = mentor.get("name")
        except Exception:
            logger.exception("Failed to backfill mentor names for match listing")

    emails: Dict[str, Optional[str]] = {}
    if include_startup_email:
        user_oids = _object_ids(doc.get("user_id") for doc in docs)
        if user_oids:
            try:
                for user in get_users_collection().find({"_id": {"$in": user_oids}}, {"email": 1}):
                    emails[str(user["_id"])] = user.get("email")
            except Exception:
                logger.exception("Failed to look up startup emails for match listing")

    for doc in docs:
        if not doc.get("mentor_name"):
            doc["mentor_name"] = names.get(str(doc.get("mentor_id") or ""))
        if include_startup_email:
            doc["startup_email"] = emails.get(str(doc.get("user_id") or ""))
    return docs
