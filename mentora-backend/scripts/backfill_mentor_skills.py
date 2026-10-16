"""
Backfill mentor `skills` + `skill_embeddings` and re-embed every mentor's
profile `embedding` in place (no deletes, unlike seed_mentors.py).

  * Seeded mentors (matched by their seed email, or by name for a `seeded`
    document whose email changed) get the `skills` list from seed_mentors.py.
  * Every other mentor keeps the `skills` it already has (set through
    PATCH /mentor/profile); mentors without skills only get re-embedded.
  * `skill_embeddings` (one passage embedding per skill) is recomputed for
    every mentor with skills, and `embedding` is recomputed from
    build_mentor_profile_text(), which now includes the skills.

Idempotent: re-running it rewrites the same values.

Usage (from mentora-backend/):

    MONGODB_DB_NAME=mentora_staging venv/bin/python scripts/backfill_mentor_skills.py --dry-run
    MONGODB_DB_NAME=mentora_staging venv/bin/python scripts/backfill_mentor_skills.py

For the shared `mentora` database you must also pass --allow-prod-db (take a
`mongodump` first).
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings  # noqa: E402
from app.db.mongo import get_mentors_collection  # noqa: E402
from app.services.embeddings import build_mentor_profile_text, embed_passage, embed_passages  # noqa: E402
from seed_mentors import MENTORS  # noqa: E402

PROTECTED_DB_NAMES = {"mentora"}


def _seed_by_email() -> dict:
    return {mentor["email"].lower(): mentor for mentor in MENTORS}


def _seed_for(doc: dict, seeds: dict):
    """The seed entry of a seeded mentor: by email, or by name for a
    `seeded` document whose email was changed (e.g. claimed by a demo login)."""
    seed = seeds.get((doc.get("email") or "").strip().lower())
    if seed is None and doc.get("seeded"):
        seed = next((m for m in seeds.values() if m["name"] == doc.get("name")), None)
    return seed


def planned_update(doc: dict, seeds: dict) -> dict:
    """The $set for one mentor document.

    Unclaimed seeded mentors always take the seed skills; any other mentor
    keeps the skills it has, and a claimed seeded mentor without skills
    falls back to its seed skills.
    """
    seed = _seed_for(doc, seeds)
    existing = [str(s).strip() for s in (doc.get("skills") or []) if str(s).strip()]
    if seed is not None and (not doc.get("user_id") or not existing):
        skills = list(seed["skills"])
    else:
        skills = existing

    text = build_mentor_profile_text(
        domain=doc.get("domain") or "",
        stage_focus=doc.get("stage_focus") or "all",
        expertise=doc.get("expertise") or [],
        skills=skills,
        bio=doc.get("bio"),
        past_exits=doc.get("past_exits"),
        years_experience=doc.get("years_experience"),
    )
    return {
        "skills": skills,
        "skill_embeddings": embed_passages(skills),
        "embedding": embed_passage(text),
        "embedding_updated_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    parser.add_argument("--allow-prod-db", action="store_true", help="allow writing to the `mentora` DB")
    args = parser.parse_args()

    if settings.MONGODB_DB_NAME in PROTECTED_DB_NAMES and not args.allow_prod_db:
        print(
            f"Refusing to write to the shared {settings.MONGODB_DB_NAME!r} database without --allow-prod-db.",
            file=sys.stderr,
        )
        return 2

    seeds = _seed_by_email()
    collection = get_mentors_collection()
    docs = list(collection.find({}, {"embedding": 0, "skill_embeddings": 0}))
    print(f"db={settings.MONGODB_DB_NAME!r}: {len(docs)} mentor document(s){' (dry run)' if args.dry_run else ''}")

    with_skills = 0
    for doc in docs:
        update = planned_update(doc, seeds)
        with_skills += bool(update["skills"])
        print(f"  {doc.get('name')!s:20s} skills={len(update['skills'])} {update['skills'][:2]}")
        if not args.dry_run:
            collection.update_one({"_id": doc["_id"]}, {"$set": update})

    print(f"{'Would update' if args.dry_run else 'Updated'} {len(docs)} mentor(s); {with_skills} with skills.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
