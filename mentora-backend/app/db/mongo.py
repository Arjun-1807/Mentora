"""
MongoDB client setup using pymongo (sync driver), used consistently
across the whole app (seed_mentors.py included).
"""
from functools import lru_cache

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from app.config import settings


@lru_cache
def get_mongo_client() -> MongoClient:
    """Cached singleton MongoClient so we don't reopen connections per-request."""
    return MongoClient(settings.MONGODB_URI)


def get_database() -> Database:
    return get_mongo_client()[settings.MONGODB_DB_NAME]


def get_mentors_collection() -> Collection:
    return get_database()[settings.MONGODB_MENTORS_COLLECTION]
