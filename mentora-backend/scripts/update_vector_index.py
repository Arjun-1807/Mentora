"""
Update the Atlas Vector Search index on `mentors` to the definition the
matcher needs: the 768-dim cosine `embedding` vector plus the filter fields
used by the $vectorSearch pre-filter (`listed`, `active`) and, for the
tenancy work, `visibility.scope` / `visibility.org_ids`.

Usage (from mentora-backend/):

    MONGODB_DB_NAME=mentora_staging venv/bin/python scripts/update_vector_index.py --dry-run
    MONGODB_DB_NAME=mentora_staging venv/bin/python scripts/update_vector_index.py

The shared `mentora` database additionally needs --allow-prod-db. The
script creates the index if it does not exist, otherwise updates it in
place, then waits until Atlas reports the new definition as queryable
(queries keep using the previous definition while it rebuilds).
"""
import argparse
import json
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from pymongo.operations import SearchIndexModel  # noqa: E402

from app.config import settings  # noqa: E402
from app.db.mongo import get_mentors_collection  # noqa: E402

PROTECTED_DB_NAMES = {"mentora"}


def index_definition() -> dict:
    return {
        "fields": [
            {
                "type": "vector",
                "path": "embedding",
                "numDimensions": settings.EMBEDDING_DIMENSIONS,
                "similarity": "cosine",
            },
            {"type": "filter", "path": "listed"},
            {"type": "filter", "path": "active"},
            {"type": "filter", "path": "visibility.scope"},
            {"type": "filter", "path": "visibility.org_ids"},
        ]
    }


def _current(collection, name):
    for index in collection.list_search_indexes(name):
        return index
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-prod-db", action="store_true")
    parser.add_argument("--timeout", type=int, default=600, help="seconds to wait for the index to be queryable")
    args = parser.parse_args()

    if settings.MONGODB_DB_NAME in PROTECTED_DB_NAMES and not args.allow_prod_db:
        print(f"Refusing to change the index of {settings.MONGODB_DB_NAME!r} without --allow-prod-db.", file=sys.stderr)
        return 2

    name = settings.MONGODB_VECTOR_INDEX_NAME
    collection = get_mentors_collection()
    definition = index_definition()
    existing = _current(collection, name)
    print(f"db={settings.MONGODB_DB_NAME!r} index={name!r}")
    print("current:", json.dumps((existing or {}).get("latestDefinition"), indent=2))
    print("target: ", json.dumps(definition, indent=2))
    if args.dry_run:
        return 0

    if existing is None:
        collection.create_search_index(SearchIndexModel(definition=definition, name=name, type="vectorSearch"))
    else:
        collection.update_search_index(name, definition)

    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        index = _current(collection, name) or {}
        if index.get("queryable") and index.get("status") == "READY" and index.get("latestDefinition") == definition:
            print("Index is READY with the new definition.")
            return 0
        print(f"  status={index.get('status')} queryable={index.get('queryable')} ...")
        time.sleep(5)
    print("Timed out waiting for the index; check its status in Atlas.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
