"""
MongoDB client setup using pymongo (sync driver), used consistently
across the whole app (seed_mentors.py included).

`ensure_indexes()` is idempotent and is called from the FastAPI startup
handler in app/main.py.
"""
import logging
from functools import lru_cache

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from app.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def get_mongo_client() -> MongoClient:
    """Cached singleton MongoClient so we don't reopen connections per-request."""
    return MongoClient(settings.MONGODB_URI)


def get_database() -> Database:
    return get_mongo_client()[settings.MONGODB_DB_NAME]


def get_mentors_collection() -> Collection:
    return get_database()[settings.MONGODB_MENTORS_COLLECTION]


def get_feedback_collection() -> Collection:
    return get_database()[settings.MONGODB_FEEDBACK_COLLECTION]


def get_matches_collection() -> Collection:
    return get_database()[settings.MONGODB_MATCHES_COLLECTION]


def get_users_collection() -> Collection:
    return get_database()[settings.MONGODB_USERS_COLLECTION]


def _safe_create_index(collection: Collection, keys: list, **kwargs) -> None:
    """Create one index, logging (not raising) on failure.

    Each index is created independently so that a single failure - e.g. a
    unique index rejected because of pre-existing duplicate legacy
    documents - does not prevent the remaining indexes from being created.
    """
    try:
        collection.create_index(keys, **kwargs)
    except Exception:
        logger.exception(
            "Could not create index %s on collection %r",
            kwargs.get("name", keys),
            collection.name,
        )


def ensure_indexes() -> None:
    """Create the indexes the app relies on. Safe to call repeatedly.

    - users.email           unique -> closes the register check-then-insert
                                      race (DuplicateKeyError -> 400).
    - matches.match_id      unique -> match ids are the handle used by
                                      /email and /feedback.
    - matches.user_id              -> per-user match listing (/matches/all).
    - matches.mentor_id            -> mentor-side match listing.
    - matches (user_id, mentor_id, profile_fingerprint) unique (partial)
                                   -> de-duplicates repeated /match calls.
    - feedback.match_id     unique -> one feedback per match (idempotency).
    - feedback.mentor_id           -> effectiveness_score aggregation.
    """
    users = get_users_collection()
    matches = get_matches_collection()
    feedback = get_feedback_collection()

    _safe_create_index(users, [("email", ASCENDING)], unique=True, name="uniq_email")

    _safe_create_index(matches, [("match_id", ASCENDING)], unique=True, name="uniq_match_id")
    _safe_create_index(
        matches, [("user_id", ASCENDING), ("timestamp", DESCENDING)], name="user_id_timestamp"
    )
    _safe_create_index(matches, [("mentor_id", ASCENDING)], name="mentor_id")
    _safe_create_index(
        matches,
        [("user_id", ASCENDING), ("mentor_id", ASCENDING), ("profile_fingerprint", ASCENDING)],
        unique=True,
        name="uniq_user_mentor_profile",
        # Legacy match documents predate these fields; exclude them so the
        # unique index can be built on an existing collection.
        partialFilterExpression={"user_id": {"$exists": True}},
    )

    _safe_create_index(feedback, [("match_id", ASCENDING)], unique=True, name="uniq_match_id")
    _safe_create_index(feedback, [("mentor_id", ASCENDING)], name="mentor_id")

    logger.info("MongoDB index creation attempted for users/matches/feedback")
