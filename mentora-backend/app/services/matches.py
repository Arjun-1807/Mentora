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

2. **Status lifecycle.** `pending` -> `emailed` -> `completed`, advanced
   only forwards (see `advance_match_status`).
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Iterable, List, Optional
from uuid import uuid4

from pymongo import ReturnDocument

from app.db.mongo import get_matches_collection
from app.models.schemas import MentorMatch, StartupProfile

logger = logging.getLogger(__name__)

# Ordered status vocabulary; index == lifecycle position.
MATCH_STATUS_ORDER: List[str] = ["pending", "emailed", "completed"]


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
    try:
        result = get_matches_collection().update_one(
            {"match_id": match_id, "user_id": user_id, "status": {"$in": earlier}},
            {"$set": {"status": new_status, "status_updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        logger.exception("Failed to advance match %s to status %r", match_id, new_status)
        return False

    return result.modified_count > 0
