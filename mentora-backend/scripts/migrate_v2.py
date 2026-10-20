"""
migrate_v2.py - tenancy backfill (Phase 1). Idempotent; safe to re-run.

What it does (each step only touches documents that still need it):
  1. creates the `legacy` organization and its `default` cohort;
  2. users without an org get org_id / cohort_id / cohort_ids of the legacy
     default cohort (users with a cohort_id but no cohort_ids get the list);
  3. self-registered coordinators (role coordinator, no invite_id) are
     demoted to startup, unless their email is in --keep-coordinators; kept
     coordinators are recorded on the legacy cohort's coordinator_user_ids;
  4. mentors get default `visibility` {scope: global, org_ids: []},
     `listed: true` and `active: true` where missing;
  5. (real runs only) creates the new indexes via ensure_indexes().

Take a backup first:   mongodump --uri "$MONGODB_URI" --db <name> --out ./backup
Preview (read-only):   python scripts/migrate_v2.py --db mentora --dry-run
Apply:                 python scripts/migrate_v2.py --db mentora_staging --confirm mentora_staging \\
                           --keep-coordinators alice@incubator.org,bob@incubator.org

A real run requires --confirm <db name> to match the target database, so
the shared database is never migrated by accident.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LEGACY_ORG_SLUG = "legacy"
LEGACY_ORG_NAME = "Legacy (pre-tenancy users)"
DEFAULT_COHORT_NAME = "default"
DEFAULT_VISIBILITY = {"scope": "global", "org_ids": []}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_or_create(collection, query: Dict[str, Any], on_insert: Dict[str, Any], dry_run: bool):
    """Return (doc_or_None, action) where action is exists/created/would_create."""
    doc = collection.find_one(query)
    if doc is not None:
        return doc, "exists"
    if dry_run:
        return None, "would_create"
    collection.update_one(query, {"$setOnInsert": {**query, **on_insert}}, upsert=True)
    return collection.find_one(query), "created"


def migrate(db, *, dry_run: bool = True, keep_coordinators: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """Run (or preview) the migration on `db` and return the diff counts."""
    from app.config import settings

    keep = {email.strip().lower() for email in (keep_coordinators or []) if email and email.strip()}
    users = db[settings.MONGODB_USERS_COLLECTION]
    mentors = db[settings.MONGODB_MENTORS_COLLECTION]
    cohorts = db[settings.MONGODB_COHORTS_COLLECTION]
    report: Dict[str, Any] = {"dry_run": dry_run}

    # 1. legacy org + default cohort
    org, report["legacy_org"] = _get_or_create(
        db[settings.MONGODB_ORGANIZATIONS_COLLECTION],
        {"slug": LEGACY_ORG_SLUG},
        {"name": LEGACY_ORG_NAME, "timezone": "Asia/Kolkata", "created_at": _now()},
        dry_run,
    )
    org_id = str(org["_id"]) if org else "<legacy org>"
    cohort = None
    if org is not None:
        cohort, report["default_cohort"] = _get_or_create(
            cohorts,
            {"org_id": org_id, "name": DEFAULT_COHORT_NAME},
            {"status": "active", "coordinator_user_ids": [], "created_at": _now()},
            dry_run,
        )
    else:
        report["default_cohort"] = "would_create"
    cohort_id = str(cohort["_id"]) if cohort else "<default cohort>"

    # 2. users -> legacy org / default cohort
    no_org = {"org_id": {"$exists": False}}
    report["users_total"] = users.count_documents({})
    report["users_backfilled"] = users.count_documents(no_org)
    no_list = {"org_id": {"$exists": True}, "cohort_id": {"$type": "string"}, "cohort_ids": {"$exists": False}}
    report["users_cohort_ids_backfilled"] = users.count_documents(no_list)
    if not dry_run:
        users.update_many(no_org, {"$set": {"org_id": org_id, "cohort_id": cohort_id, "cohort_ids": [cohort_id]}})
        for doc in users.find(no_list, {"cohort_id": 1}):
            users.update_one({"_id": doc["_id"]}, {"$set": {"cohort_ids": [doc["cohort_id"]]}})

    # 3. self-registered coordinators
    self_registered = {"role": "coordinator", "invite_id": {"$exists": False}}
    demote, kept = [], []
    for doc in users.find(self_registered, {"email": 1}):
        (kept if str(doc.get("email") or "").lower() in keep else demote).append(doc)
    report["coordinators_demoted"] = len(demote)
    report["coordinator_emails_demoted"] = sorted(str(d.get("email")) for d in demote)
    already = set((cohort or {}).get("coordinator_user_ids") or [])
    newly_kept = [d for d in kept if str(d["_id"]) not in already]
    report["coordinators_kept"] = len(kept)
    report["coordinators_linked_to_default_cohort"] = len(newly_kept)
    if not dry_run:
        if demote:
            users.update_many(
                {"_id": {"$in": [d["_id"] for d in demote]}, "role": "coordinator"},
                {"$set": {"role": "startup", "demoted_from": "coordinator", "demoted_at": _now()}},
            )
        if newly_kept and cohort is not None:
            cohorts.update_one(
                {"_id": cohort["_id"]},
                {"$addToSet": {"coordinator_user_ids": {"$each": [str(d["_id"]) for d in newly_kept]}}},
            )

    # 4. mentor visibility / listing defaults
    report["mentors_total"] = mentors.count_documents({})
    for field, value in (("visibility", DEFAULT_VISIBILITY), ("listed", True), ("active", True)):
        query = {field: {"$exists": False}}
        report[f"mentors_{field}_backfilled"] = mentors.count_documents(query)
        if not dry_run:
            mentors.update_many(query, {"$set": {field: value}})

    return report


def _changes(report: Dict[str, Any]) -> int:
    """Number of document changes a report describes (0 = nothing to do)."""
    keys = (
        "users_backfilled",
        "users_cohort_ids_backfilled",
        "coordinators_demoted",
        "coordinators_linked_to_default_cohort",
        "mentors_visibility_backfilled",
        "mentors_listed_backfilled",
        "mentors_active_backfilled",
    )
    created = sum(1 for key in ("legacy_org", "default_cohort") if report.get(key) != "exists")
    return created + sum(int(report.get(key) or 0) for key in keys)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", help="Database name (default: MONGODB_DB_NAME from the environment/.env)")
    parser.add_argument("--dry-run", action="store_true", help="Only report what would change")
    parser.add_argument("--confirm", help="Required for a real run: must equal the target database name")
    parser.add_argument(
        "--keep-coordinators", default="", help="Comma-separated emails of coordinators to keep (not demote)"
    )
    args = parser.parse_args(argv)

    if args.db:
        os.environ["MONGODB_DB_NAME"] = args.db
    from app.config import settings
    from app.db.mongo import ensure_indexes, get_database

    db_name = settings.MONGODB_DB_NAME
    if not args.dry_run and args.confirm != db_name:
        print(f"Refusing to migrate '{db_name}': pass --confirm {db_name} (or use --dry-run).", file=sys.stderr)
        return 2

    keep = [email for email in args.keep_coordinators.split(",") if email.strip()]
    report = migrate(get_database(), dry_run=args.dry_run, keep_coordinators=keep)
    if not args.dry_run:
        ensure_indexes()

    print(f"migrate_v2 on database '{db_name}' ({'DRY RUN - nothing written' if args.dry_run else 'APPLIED'})")
    for key, value in report.items():
        print(f"  {key}: {value}")
    print(f"  total_changes: {_changes(report)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
