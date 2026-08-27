# Mentora Backend

FastAPI backend for Mentora, a startup-mentor matching app. It extracts a
structured profile from a startup's pitch deck (PDF) using Groq (model
configurable via `GROQ_MODEL`, defaults to `openai/gpt-oss-20b` — Groq
decommissions models periodically, check `client.models.list()` or
https://console.groq.com/docs/deprecations if extraction starts failing
with a `model_decommissioned` error), then matches the startup against a
mentor database using vector similarity search (BAAI/bge-base-en-v1.5
embeddings) on MongoDB Atlas.

## Features

- `POST /extract` - upload a pitch deck PDF, get back structured JSON
  (`domain`, `stage`, `challenges`, `team_gaps`) via PyMuPDF + Groq.
- `POST /match` - submit a structured startup profile, get back the top 5
  matching mentors via MongoDB Atlas `$vectorSearch` + a domain/stage
  weighted score boost.

## 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

`torch` and `sentence-transformers` are CPU-friendly; no GPU is required.
The `BAAI/bge-base-en-v1.5` model (~440MB) is downloaded from the Hugging
Face Hub the first time it's used (either the first `/match` request or
when running `seed_mentors.py`) and cached locally afterwards, so the
first call will be slower.

## 2. Configure environment variables

Copy the example env file and fill in your real credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
GROQ_API_KEY=your_groq_api_key_here
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-url>/?retryWrites=true&w=majority
```

- Get a Groq API key from https://console.groq.com/
- Get a MongoDB Atlas connection string from your Atlas cluster's "Connect"
  dialog. Make sure your current IP is allow-listed in Atlas Network Access.

Never commit `.env` — it's already excluded via `.gitignore`.

## 3. Create the MongoDB Atlas Vector Search index

The app queries a `mentors` collection (in the `mentora` database) using
the `$vectorSearch` aggregation stage against an Atlas Vector Search index
named `mentor_vector_index`, defined on the `embedding` field. **This index
cannot be created via a plain pymongo call** — you must create it manually
via the Atlas UI, the `mongosh`/`db.collection.createSearchIndex()` helper,
or the Atlas Admin API.

### Option A: Atlas UI

1. In Atlas, go to your cluster -> **Search** tab -> **Create Search Index**.
2. Choose **JSON Editor**, select the `mentora` database and `mentors`
   collection.
3. Name the index exactly `mentor_vector_index` and paste the following
   definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

4. Create the index and wait for its status to become **Active** (usually
   under a minute for a small collection).

### Option B: mongosh

```javascript
use mentora
db.mentors.createSearchIndex(
  "mentor_vector_index",
  "vectorSearch",
  {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 768,
        similarity: "cosine"
      }
    ]
  }
)
```

### Option C: Atlas Administration API

You can also create the index programmatically via the [Atlas Admin API
`createSearchIndex` endpoint](https://www.mongodb.com/docs/atlas/reference/api-resources-spec/#tag/Atlas-Search),
using the same JSON body shown in Option A.

> Note: 768 matches the output dimensionality of `BAAI/bge-base-en-v1.5`.
> If you swap embedding models, update `EMBEDDING_DIMENSIONS` in `.env`
> **and** the index definition together, then re-run `seed_mentors.py`.

## 4. Seed the mentors collection

Once `.env` is configured and the Atlas index has been created (seeding
data can happen before or after index creation, but `/match` won't work
until the index is Active):

```bash
python seed_mentors.py
```

This clears the `mentors` collection and inserts 15 mentor profiles, each
with a `BAAI/bge-base-en-v1.5` embedding computed from their
domain/stage_focus/expertise (passage-side, no query prefix — see
"Embedding convention" below).

## 5. Run the server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`, with interactive
docs at `http://localhost:8000/docs`. CORS is enabled for
`http://localhost:3000` (the expected frontend origin) by default —
override via `FRONTEND_ORIGIN` in `.env` if needed.

## API reference

### `POST /extract`

- Content-Type: `multipart/form-data`, field name `file` (a PDF).
- Response 200:
  ```json
  {
    "domain": "Fintech",
    "stage": "MVP",
    "challenges": ["Customer acquisition cost is high", "Limited runway"],
    "team_gaps": ["No dedicated CTO", "No sales lead"]
  }
  ```
- Errors: `400` for a non-PDF or empty upload, `422` if no text could be
  extracted (e.g. a scanned/image-only PDF), `502` if the Groq API call
  fails or repeatedly returns unparseable JSON, `500` if `GROQ_API_KEY`
  is missing.

### `POST /match`

- Content-Type: `application/json`, body shaped like the `/extract`
  response:
  ```json
  {
    "domain": "Fintech",
    "stage": "MVP",
    "challenges": ["Customer acquisition cost is high"],
    "team_gaps": ["No dedicated CTO"]
  }
  ```
- Response 200:
  ```json
  {
    "matches": [
      {
        "name": "Ava Chen",
        "domain": "Fintech",
        "stage_focus": "idea",
        "expertise": ["Fundraising", "Product-Market Fit", "Regulatory Compliance"],
        "match_score": 0.87
      }
    ]
  }
  ```
- `match_score` is a float in the `0.0`-`1.0` range: the raw cosine
  similarity from Atlas Vector Search (`$meta: "vectorSearchScore"`) plus
  weighted boosts, clamped to `1.0`.

## Scoring / matching details

- Embeddings: `sentence-transformers` with `BAAI/bge-base-en-v1.5`,
  L2-normalized (`normalize_embeddings=True`), 768 dimensions.
- **Embedding convention (important, and consistent across the whole
  codebase)**: BGE models are trained asymmetrically.
  - Query side (`/match`'s incoming startup profile) is embedded with the
    prefix `"Represent this sentence for searching relevant passages: "`.
  - Passage side (mentor profiles, both in `seed_mentors.py` and anywhere
    else a mentor doc is embedded) is embedded with **no prefix**.
  - Both live in `app/services/embeddings.py` (`embed_query` /
    `embed_passage`) so this convention can't drift between the seeder and
    the API.
- Weighted score boost (tunable constants at the top of
  `app/services/mentor_matching.py`):
  - `DOMAIN_MATCH_BOOST = 0.10` — added if the mentor's `domain` exactly
    matches (case-insensitive) the startup's `domain`.
  - `STAGE_MATCH_BOOST = 0.10` — added if the mentor's `stage_focus`
    exactly matches (case-insensitive) the startup's `stage`.
- Vector search pulls the top 20 raw candidates (`numCandidates` = 200)
  from Atlas, applies the boosts, re-sorts, and returns the top 5.

## Project structure

```
mentora-backend/
  app/
    main.py                  # FastAPI app, CORS, router registration
    config.py                # pydantic-settings config loaded from .env
    routers/
      extract.py              # POST /extract
      match.py                 # POST /match
    services/
      pdf_extract.py          # PyMuPDF text extraction
      llm.py                   # Groq API call + prompt + JSON parsing/validation
      embeddings.py            # sentence-transformers BGE wrapper (singleton)
      mentor_matching.py       # Atlas $vectorSearch query + score boosting
    models/
      schemas.py               # Pydantic request/response models
    db/
      mongo.py                 # pymongo client setup
  seed_mentors.py               # seeds 15 mentor profiles + embeddings
  requirements.txt
  .env.example
  .gitignore
  README.md
```

## Notes / limitations

- MongoDB access uses `pymongo` (sync) consistently throughout the app
  and the seed script — no `motor`/async driver is mixed in.
- The Groq call requests JSON mode (`response_format={"type":
  "json_object"}`) and defensively re-validates the result against a
  Pydantic model, retrying once on malformed/invalid JSON before raising
  a `502`.
- Network calls to Groq and MongoDB Atlas will only succeed once you've
  supplied real credentials in `.env` and created the Atlas Search index
  described above.
