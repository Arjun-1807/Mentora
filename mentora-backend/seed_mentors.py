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
"send intro email" flow.

Note: passage-side text is embedded WITHOUT the BGE query instruction
prefix, matching the convention used for query-side embeddings in
app/services/embeddings.py (see embed_passage / embed_query there).
"""
import sys
from typing import List, TypedDict

from app.config import settings
from app.db.mongo import get_mentors_collection
from app.services.embeddings import build_mentor_profile_text, embed_passage


class MentorSeed(TypedDict):
    name: str
    domain: str
    stage_focus: str
    expertise: List[str]
    geography: str
    email: str


MENTORS: List[MentorSeed] = [
    {
        "name": "Ava Chen",
        "email": "ava.chen@mentors.mentora.dev",
        "domain": "Fintech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
        "geography": "San Francisco, CA",
    },
    {
        "name": "Marcus Reid",
        "email": "marcus.reid@mentors.mentora.dev",
        "domain": "Fintech",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Go-to-Market", "Scaling Operations"],
        "geography": "New York, NY",
    },
    {
        "name": "Priya Nair",
        "email": "priya.nair@mentors.mentora.dev",
        "domain": "HealthTech",
        "stage_focus": "MVP",
        "expertise": ["Product-Market Fit", "Clinical Partnerships", "Regulatory Compliance"],
        "geography": "Bangalore, India",
    },
    {
        "name": "David Okafor",
        "email": "david.okafor@mentors.mentora.dev",
        "domain": "HealthTech",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Hiring", "Go-to-Market"],
        "geography": "London, UK",
    },
    {
        "name": "Elena Petrova",
        "email": "elena.petrova@mentors.mentora.dev",
        "domain": "EdTech",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Curriculum Design"],
        "geography": "Remote",
    },
    {
        "name": "Tom Sullivan",
        "email": "tom.sullivan@mentors.mentora.dev",
        "domain": "EdTech",
        "stage_focus": "MVP",
        "expertise": ["Go-to-Market", "B2B Sales", "Partnerships"],
        "geography": "Boston, MA",
    },
    {
        "name": "Sofia Marquez",
        "email": "sofia.marquez@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "MVP",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
        "geography": "Austin, TX",
    },
    {
        "name": "James Whitfield",
        "email": "james.whitfield@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Fundraising", "Scaling Operations"],
        "geography": "New York, NY",
    },
    {
        "name": "Grace Kim",
        "email": "grace.kim@mentors.mentora.dev",
        "domain": "E-commerce",
        "stage_focus": "idea",
        "expertise": ["Go-to-Market", "Branding", "Supply Chain"],
        "geography": "Seoul, South Korea",
    },
    {
        "name": "Ben Alaoui",
        "email": "ben.alaoui@mentors.mentora.dev",
        "domain": "E-commerce",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Scaling Operations", "B2B Sales"],
        "geography": "Dubai, UAE",
    },
    {
        "name": "Nadia Hassan",
        "email": "nadia.hassan@mentors.mentora.dev",
        "domain": "AI/ML",
        "stage_focus": "idea",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
        "geography": "Remote",
    },
    {
        "name": "Liam O'Connor",
        "email": "liam.oconnor@mentors.mentora.dev",
        "domain": "AI/ML",
        "stage_focus": "MVP",
        "expertise": ["Fundraising", "Technical Architecture", "Go-to-Market"],
        "geography": "Dublin, Ireland",
    },
    {
        "name": "Chloe Dubois",
        "email": "chloe.dubois@mentors.mentora.dev",
        "domain": "Climate Tech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
        "geography": "Paris, France",
    },
    {
        "name": "Ravi Deshmukh",
        "email": "ravi.deshmukh@mentors.mentora.dev",
        "domain": "Climate Tech",
        "stage_focus": "growth",
        "expertise": ["Go-to-Market", "B2B Sales", "Scaling Operations"],
        "geography": "Bangalore, India",
    },
    {
        "name": "Hannah Fischer",
        "email": "hannah.fischer@mentors.mentora.dev",
        "domain": "SaaS",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Hiring"],
        "geography": "Berlin, Germany",
    },
]


def main() -> None:
    print(f"Connecting to MongoDB at {settings.MONGODB_URI!r}, db={settings.MONGODB_DB_NAME!r} ...")
    collection = get_mentors_collection()

    print(f"Clearing previously seeded documents in '{collection.name}' collection ...")
    # Only mentors without a linked user account; registered mentors stay.
    delete_result = collection.delete_many({"user_id": {"$exists": False}})
    print(f"  Deleted {delete_result.deleted_count} existing seeded document(s).")

    print(f"Loading embedding model '{settings.EMBEDDING_MODEL_NAME}' (this may take a while on first run) ...")

    docs = []
    for i, mentor in enumerate(MENTORS, start=1):
        text = build_mentor_profile_text(
            domain=mentor["domain"],
            stage_focus=mentor["stage_focus"],
            expertise=mentor["expertise"],
        )
        embedding = embed_passage(text)

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
                "embedding": embedding,
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
