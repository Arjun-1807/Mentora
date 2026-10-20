"""
create_org.py - bootstrap an incubator: organization + cohort + the first
coordinator invite. Re-running with the same slug/cohort reuses them and
just issues a fresh invite.

    python scripts/create_org.py --slug acme-labs --name "Acme Labs" \\
        --cohort "Spring 2027" --coordinator-email lead@acmelabs.org

Prints a single-use, email-bound link such as
http://localhost:3000/join/<token>; the coordinator registers there and can
then invite startups, mentors and other coordinators from /coordinator.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--slug", required=True, help="URL-safe org identifier, e.g. acme-labs")
    parser.add_argument("--name", required=True, help="Display name, e.g. 'Acme Labs'")
    parser.add_argument("--cohort", default="Cohort 1", help="First cohort's name (default: 'Cohort 1')")
    parser.add_argument("--timezone", default="Asia/Kolkata", help="IANA timezone (default: Asia/Kolkata)")
    parser.add_argument("--coordinator-email", required=True, help="Email the coordinator invite is bound to")
    parser.add_argument("--expires-days", type=int, default=None, help="Invite lifetime in days (default: 14)")
    parser.add_argument("--base-url", default=None, help="Frontend origin for the link (default: FRONTEND_ORIGIN)")
    parser.add_argument("--db", help="Database name (default: MONGODB_DB_NAME from the environment/.env)")
    args = parser.parse_args(argv)

    if args.db:
        os.environ["MONGODB_DB_NAME"] = args.db
    from app.config import settings
    from app.db.mongo import ensure_indexes
    from app.services.tenancy import LEGACY_ORG_SLUG, create_invite, get_or_create_cohort, get_or_create_org, invite_url

    slug = args.slug.strip().lower()
    if not slug or slug == LEGACY_ORG_SLUG:
        print(f"Invalid slug {args.slug!r} ('{LEGACY_ORG_SLUG}' is reserved).", file=sys.stderr)
        return 2

    ensure_indexes()
    org = get_or_create_org(slug, args.name.strip(), args.timezone)
    cohort = get_or_create_cohort(str(org["_id"]), args.cohort.strip())
    token, invite = create_invite(
        org_id=str(org["_id"]),
        cohort_id=str(cohort["_id"]),
        role="coordinator",
        email=args.coordinator_email,
        expires_in_days=args.expires_days,
        created_by="scripts/create_org.py",
    )

    print(f"Database:    {settings.MONGODB_DB_NAME}")
    print(f"Org:         {org['name']} (slug={org['slug']}, id={org['_id']})")
    print(f"Cohort:      {cohort['name']} (id={cohort['_id']})")
    print(f"Coordinator: {invite['email']} (single use, expires {invite['expires_at'].isoformat()})")
    print(f"Invite URL:  {invite_url(token, args.base_url)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
