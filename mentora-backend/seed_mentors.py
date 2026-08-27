"""
Standalone script to seed 15 realistic dummy mentor profiles, complete
with BAAI/bge-base-en-v1.5 embeddings, into the MongoDB Atlas `mentors`
collection.

Usage:
    python seed_mentors.py

Requires MONGODB_URI to be set in .env (see .env.example). This script
clears the existing `mentors` collection and re-inserts all 15 profiles,
so it is safe to re-run any time you change the mentor data or the
embedding model.

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


MENTORS: List[MentorSeed] = [
    {
        "name": "Ava Chen",
        "domain": "Fintech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
    },
    {
        "name": "Marcus Reid",
        "domain": "Fintech",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Go-to-Market", "Scaling Operations"],
    },
    {
        "name": "Priya Nair",
        "domain": "HealthTech",
        "stage_focus": "MVP",
        "expertise": ["Product-Market Fit", "Clinical Partnerships", "Regulatory Compliance"],
    },
    {
        "name": "David Okafor",
        "domain": "HealthTech",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Hiring", "Go-to-Market"],
    },
    {
        "name": "Elena Petrova",
        "domain": "EdTech",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Curriculum Design"],
    },
    {
        "name": "Tom Sullivan",
        "domain": "EdTech",
        "stage_focus": "MVP",
        "expertise": ["Go-to-Market", "B2B Sales", "Partnerships"],
    },
    {
        "name": "Sofia Marquez",
        "domain": "SaaS",
        "stage_focus": "MVP",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
    },
    {
        "name": "James Whitfield",
        "domain": "SaaS",
        "stage_focus": "growth",
        "expertise": ["B2B Sales", "Fundraising", "Scaling Operations"],
    },
    {
        "name": "Grace Kim",
        "domain": "E-commerce",
        "stage_focus": "idea",
        "expertise": ["Go-to-Market", "Branding", "Supply Chain"],
    },
    {
        "name": "Ben Alaoui",
        "domain": "E-commerce",
        "stage_focus": "growth",
        "expertise": ["Fundraising", "Scaling Operations", "B2B Sales"],
    },
    {
        "name": "Nadia Hassan",
        "domain": "AI/ML",
        "stage_focus": "idea",
        "expertise": ["Technical Architecture", "Product-Market Fit", "Hiring"],
    },
    {
        "name": "Liam O'Connor",
        "domain": "AI/ML",
        "stage_focus": "MVP",
        "expertise": ["Fundraising", "Technical Architecture", "Go-to-Market"],
    },
    {
        "name": "Chloe Dubois",
        "domain": "Climate Tech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
    },
    {
        "name": "Ravi Deshmukh",
        "domain": "Climate Tech",
        "stage_focus": "growth",
        "expertise": ["Go-to-Market", "B2B Sales", "Scaling Operations"],
    },
    {
        "name": "Hannah Fischer",
        "domain": "SaaS",
        "stage_focus": "idea",
        "expertise": ["Product-Market Fit", "User Research", "Hiring"],
    },
]


def main() -> None:
    print(f"Connecting to MongoDB at {settings.MONGODB_URI!r}, db={settings.MONGODB_DB_NAME!r} ...")
    collection = get_mentors_collection()

    print(f"Clearing existing documents in '{collection.name}' collection ...")
    delete_result = collection.delete_many({})
    print(f"  Deleted {delete_result.deleted_count} existing document(s).")

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
                "embedding": embedding,
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
