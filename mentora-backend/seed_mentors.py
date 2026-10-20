"""
Standalone script to seed 15 realistic dummy mentor profiles, complete
with BAAI/bge-base-en-v1.5 embeddings, into the MongoDB Atlas `mentors`
collection.

Usage:
    python seed_mentors.py

Requires MONGODB_URI to be set in .env (see .env.example). This script
removes the previously seeded mentors - every mentor document NOT linked
to a registered user account (no `user_id`) - and re-inserts all 15
profiles, so it is safe to re-run any time you change the mentor data or
the embedding model. Mentors who registered through the app are kept.

Each seeded mentor gets a realistic but fake contact email on the
clearly fake `mentors.mentora.dev` domain (do not expect delivery), used by the frontend's
"send intro email" flow, plus a list of functional `skills` (stored with
one passage embedding per skill in `skill_embeddings`) that the matcher
compares against a startup's challenges and team gaps.

WARNING: never run this against the shared `mentora` database - it deletes
every seeded mentor first (and therefore breaks existing match records that
point at them). It refuses to unless --yes-clear-mentora is passed. To add
skills / re-embed an existing database in place, use
scripts/backfill_mentor_skills.py instead.

Note: passage-side text is embedded WITHOUT the BGE query instruction
prefix, matching the convention used for query-side embeddings in
app/services/embeddings.py (see embed_passage / embed_query there).
"""
import sys
from typing import List, TypedDict

from app.config import settings
from app.db.mongo import get_mentors_collection
from app.services.embeddings import build_mentor_profile_text, embed_passage, embed_passages


class MentorSeed(TypedDict):
    name: str
    domain: str
    stage_focus: str
    expertise: List[str]
    geography: str
    email: str
    # Functional skills, matched one-by-one against a startup's challenges
    # and team gaps (need_fit in app/services/mentor_matching.py).
    skills: List[str]


MENTORS: List[MentorSeed] = [
    {
        "name": "Ava Chen",
        "email": "ava.chen@mentors.mentora.dev",
        "domain": "Fintech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
        "geography": "San Francisco, CA",
        "skills": [
            "Pre-seed and seed fundraising",
            "Fintech licensing and regulatory compliance",
            "Payments product strategy",
            "Customer discovery and product-market fit",
        ],
    },
    {
        "name": "Marcus Reid",
        "email": "marcus.reid@mentors.mentora.dev",
        "domain": "Fintech",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Go-to-Market", "Scaling Operations"],
        "geography": "New York, NY",
        "skills": [
            "Enterprise B2B sales for financial services",
            "Go-to-market strategy for fintech products",
            "Scaling operations and customer support",
            "Building and managing sales teams",
        ],
    },
    {
        "name": "Priya Nair",
        "email": "priya.nair@mentors.mentora.dev",
        "domain": "HealthTech",
        "stage_focus": "MVP",
        "expertise": ["Product-Market Fit", "Clinical Partnerships", "Regulatory Compliance"],
        "geography": "Bangalore, India",
        "skills": [
            "Clinical validation and pilot studies",
            "Hospital and clinic partnerships",
            "Medical device and health data regulation",
            "Healthcare product-market fit",
        ],
    },
    {
        "name": "David Okafor",
        "email": "david.okafor@mentors.mentora.dev",
        "domain": "HealthTech",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Hiring", "Go-to-Market"],
        "geography": "London, UK",
        "skills": [
            "Series A and B fundraising",
            "Hiring senior leadership teams",
            "Healthcare go-to-market and sales",
            "Expanding a health business to new markets",
        ],
    },
    {
        "name": "Elena Petrova",
        "email": "elena.petrova@mentors.mentora.dev",
        "domain": "EdTech",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Curriculum Design"],
        "geography": "Remote",
        "skills": [
            "Curriculum and learning experience design",
            "User research with students and teachers",
            "Early product-market fit validation",
            "Pedagogy and learning science",
        ],
    },
    {
        "name": "Tom Sullivan",
        "email": "tom.sullivan@mentors.mentora.dev",
        "domain": "EdTech",
        "stage_focus": "MVP",
        "expertise": ["Go-to-Market", "B2B Sales", "Partnerships"],
        "geography": "Boston, MA",
        "skills": [
            "Selling to schools and universities",
            "Education go-to-market strategy",
            "Partnerships with institutions and nonprofits",
            "Designing a B2B sales process",
        ],
    },
    {
        "name": "Sofia Marquez",
        "email": "sofia.marquez@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "MVP",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
        "geography": "Austin, TX",
        "skills": [
            "Software architecture and scalability",
            "Cloud infrastructure for SaaS platforms",
            "Hiring early engineering teams",
            "Product-market fit for B2B SaaS",
        ],
    },
    {
        "name": "James Whitfield",
        "email": "james.whitfield@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Fundraising", "Scaling Operations"],
        "geography": "New York, NY",
        "skills": [
            "Enterprise SaaS sales leadership",
            "Series A to C fundraising",
            "Scaling customer success and operations",
            "Revenue operations and pricing",
        ],
    },
    {
        "name": "Grace Kim",
        "email": "grace.kim@mentors.mentora.dev",
        "domain": "E-commerce",
        "stage_focus": "idea",
        "expertise": ["Go-to-Market", "Branding", "Supply Chain"],
        "geography": "Seoul, South Korea",
        "skills": [
            "Consumer brand building",
            "Social media and influencer marketing",
            "Sourcing and supply chain setup",
            "Launch go-to-market for consumer products",
        ],
    },
    {
        "name": "Ben Alaoui",
        "email": "ben.alaoui@mentors.mentora.dev",
        "domain": "E-commerce",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Scaling Operations", "B2B Sales"],
        "geography": "Dubai, UAE",
        "skills": [
            "Growth-stage fundraising",
            "Scaling fulfilment and warehouse operations",
            "Supplier negotiations and B2B partnerships",
            "Marketplace unit economics",
        ],
    },
    {
        "name": "Nadia Hassan",
        "email": "nadia.hassan@mentors.mentora.dev",
        "domain": "AI/ML",
        "stage_focus": "idea",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
        "geography": "Remote",
        "skills": [
            "Machine learning system architecture",
            "LLM application design",
            "Hiring ML engineers",
            "Validating AI product ideas with customers",
        ],
    },
    {
        "name": "Liam O'Connor",
        "email": "liam.oconnor@mentors.mentora.dev",
        "domain": "AI/ML",
        "stage_focus": "MVP",
        "expertise": ["Fundraising", "Technical Architecture", "Go-to-Market"],
        "geography": "Dublin, Ireland",
        "skills": [
            "Raising seed rounds for AI startups",
            "ML infrastructure and model deployment",
            "Go-to-market for AI products",
            "Running enterprise AI pilots",
        ],
    },
    {
        "name": "Chloe Dubois",
        "email": "chloe.dubois@mentors.mentora.dev",
        "domain": "Climate Tech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
        "geography": "Paris, France",
        "skills": [
            "Climate tech fundraising and grants",
            "Energy and environmental regulation",
            "Early customer validation for climate products",
            "Impact investor relations",
        ],
    },
    {
        "name": "Ravi Deshmukh",
        "email": "ravi.deshmukh@mentors.mentora.dev",
        "domain": "Climate Tech",
        "stage_focus": "growth",
        "expertise": ["Go-to-Market", "B2B Sales", "Scaling Operations"],
        "geography": "Bangalore, India",
        "skills": [
            "Enterprise sales of energy and climate solutions",
            "Go-to-market with industrial customers",
            "Scaling field operations",
            "Utility and energy partnerships",
        ],
    },
    {
        "name": "Hannah Fischer",
        "email": "hannah.fischer@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Hiring"],
        "geography": "Berlin, Germany",
        "skills": [
            "Customer interviews and user research",
            "MVP scoping and prioritisation",
            "Recruiting a founding team",
            "Product-market fit for early-stage SaaS",
        ],
    },
]


def seed_mentor_fields(mentor: MentorSeed) -> dict:
    """The embedding-bearing fields of one seeded mentor: `skills`, one
    passage embedding per skill (`skill_embeddings`) and the profile
    `embedding`. Shared with scripts/backfill_mentor_skills.py so seeding and
    in-place backfills produce identical documents."""
    text = build_mentor_profile_text(
        domain=mentor["domain"],
        stage_focus=mentor["stage_focus"],
        expertise=mentor["expertise"],
        skills=mentor["skills"],
    )
    return {
        "skills": list(mentor["skills"]),
        "skill_embeddings": embed_passages(mentor["skills"]),
        "embedding": embed_passage(text),
    }


def main() -> None:
    if settings.MONGODB_DB_NAME == "mentora" and "--yes-clear-mentora" not in sys.argv[1:]:
        print(
            "Refusing to delete the seeded mentors of the shared 'mentora' database. Use "
            "scripts/backfill_mentor_skills.py to update it in place, or pass --yes-clear-mentora.",
            file=sys.stderr,
        )
        sys.exit(2)
    # The URI is never printed: it carries the database password.
    print(f"Connecting to MongoDB, db={settings.MONGODB_DB_NAME!r} ...")
    collection = get_mentors_collection()

    print(f"Clearing previously seeded documents in '{collection.name}' collection ...")
    # Only mentors without a linked user account; registered mentors stay.
    delete_result = collection.delete_many({"user_id": {"$exists": False}})
    print(f"  Deleted {delete_result.deleted_count} existing seeded document(s).")

    print(f"Loading embedding model '{settings.EMBEDDING_MODEL_NAME}' (this may take a while on first run) ...")

    docs = []
    for i, mentor in enumerate(MENTORS, start=1):
        fields = seed_mentor_fields(mentor)
        embedding = fields["embedding"]

        if len(embedding) != settings.EMBEDDING_DIMENSIONS:
            print(
                f"WARNING: embedding dimension {len(embedding)} does not match "
                f"configured EMBEDDING_DIMENSIONS={settings.EMBEDDING_DIMENSIONS}",
                file=sys.stderr,
            )

        docs.append(
            {
                "name": mentor["name"],
                "domain": mentor["domain"],
                "stage_focus": mentor["stage_focus"],
                "expertise": mentor["expertise"],
                "geography": mentor["geography"],
                "email": mentor["email"],
                "preferred_stages": [mentor["stage_focus"]],
                "seeded": True,
                **fields,
                # No feedback yet for freshly seeded mentors; left unset until
                # POST /feedback recomputes it as a rolling average rating.
                "effectiveness_score": None,
            }
        )
        print(f"  [{i}/{len(MENTORS)}] Embedded mentor: {mentor['name']} ({mentor['domain']}, {mentor['stage_focus']})")

    print(f"Inserting {len(docs)} mentor documents into '{collection.name}' ...")
    insert_result = collection.insert_many(docs)
    print(f"  Inserted {len(insert_result.inserted_ids)} document(s).")

    print()
    print("Done. Remember: the Atlas Vector Search index "
          f"'{settings.MONGODB_VECTOR_INDEX_NAME}' must exist on the "
          f"'{collection.name}' collection's 'embedding' field "
          f"(numDimensions={settings.EMBEDDING_DIMENSIONS}, similarity='cosine') "
          "before /match will work. See README.md for the index definition.")


if __name__ == "__main__":
    main()
