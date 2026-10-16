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


def get_oauth_states_collection() -> Collection:
    return get_database()[settings.MONGODB_OAUTH_STATES_COLLECTION]


def get_meeting_notes_collection() -> Collection:
    return get_database()[settings.MONGODB_MEETING_NOTES_COLLECTION]


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
                                      race (DuplicateKeyError -> 409).
    - matches.match_id      unique -> match ids are the handle used by
                                      /email and /feedback.
    - matches.user_id              -> per-user match listing (/matches/all).
    - matches.mentor_id            -> mentor-side match listing.
    - matches (user_id, mentor_id, profile_fingerprint) unique (partial)
                                   -> de-duplicates repeated /match calls.
    - feedback.match_id     unique -> one feedback per match (idempotency).
    - feedback.mentor_id           -> effectiveness_score aggregation.
    - oauth_states.state    unique -> one-time Google OAuth state tokens.
    - oauth_states.created_at  TTL -> abandoned states expire on their own
                                      (the callback also checks the age).
    - meeting_notes (startup_id, timestamp) -> health score computation.
    - meeting_notes.match_id       -> per-match note lookups.
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

    oauth_states = get_oauth_states_collection()
    _safe_create_index(oauth_states, [("state", ASCENDING)], unique=True, name="uniq_state")
    _safe_create_index(
        oauth_states,
        [("created_at", ASCENDING)],
        expireAfterSeconds=settings.OAUTH_STATE_TTL_SECONDS,
        name="ttl_created_at",
    )

    meeting_notes = get_meeting_notes_collection()
    _safe_create_index(
        meeting_notes,
        [("startup_id", ASCENDING), ("timestamp", DESCENDING)],
        name="startup_id_timestamp",
    )
    _safe_create_index(meeting_notes, [("match_id", ASCENDING)], name="match_id")

    logger.info(
        "MongoDB index creation attempted for users/matches/feedback/oauth_states/meeting_notes"
    )
