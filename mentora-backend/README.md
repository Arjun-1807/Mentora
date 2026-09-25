# Mentora Backend

FastAPI backend for Mentora, a startup-mentor matching app. It extracts a
structured profile from a startup's pitch deck (PDF) using Groq (model
configurable via `GROQ_MODEL`, defaults to `openai/gpt-oss-20b` — Groq
decommissions models periodically, check `client.models.list()` or
https://console.groq.com/docs/deprecations if extraction starts failing
with a `model_decommissioned` error), then matches the startup against a
mentor database using vector similarity search (BAAI/bge-base-en-v1.5
embeddings) on MongoDB Atlas, drafts intro emails, and closes the loop
with feedback that feeds back into ranking.

## Features

- `POST /register`, `POST /login`, `GET /me` — JWT auth (bcrypt + PyJWT).
  Registering as a mentor also indexes a mentor document so the mentor is
  immediately matchable.
- `POST /extract` — upload a pitch-deck PDF, get structured JSON
  (`domain`, `stage`, `challenges`, `team_gaps`, `geography`) via
  PyMuPDF + Groq.
- `POST /match` — submit a structured startup profile, get the top 5
  matching mentors via MongoDB Atlas `$vectorSearch` plus a weighted
  re-rank; match records are persisted per user.
- `POST /matches/all` — the calling user's match history.
- `GET /mentors` — mentor directory (never returns embeddings).
- `POST /email` — Groq drafts an intro email; advances the match to
  `emailed`.
- `POST /feedback` — attendance + 1-5 rating, recomputes the mentor's
  rolling-average `effectiveness_score`, completes the match.
- `GET /feedback/summary` — per-mentor aggregate feedback stats.
- `POST /feedback-status` — advance a match to `emailed` / `email_sent`
  (the frontend calls it after actually delivering the intro email).
- `PATCH /mentor/profile` — mentor onboarding: saves the full mentor
  profile and re-embeds it for vector search.
- `POST /evaluate` — retrieval metrics (precision@5, recall@5, MRR,
  NDCG@5, mean cosine) of the matching pipeline against ground truth.

## 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

`torch` and `sentence-transformers` are CPU-friendly; no GPU is required.
The `BAAI/bge-base-en-v1.5` model (~440MB) is downloaded from the Hugging
Face Hub the first time it's used (the first `/match`, a mentor
registration, or `seed_mentors.py`) and cached locally afterwards, so the
first call will be slower.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Required values:

```
GROQ_API_KEY=your_groq_api_key_here
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-url>/?retryWrites=true&w=majority
JWT_SECRET=<at least 32 random characters>
```

Generate a signing secret with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**`JWT_SECRET` is validated at startup.** The app raises
`ConfigurationError` and refuses to boot if it is empty, shorter than 32
characters, or a well-known placeholder (`changeme`, `secret`, …) — an
empty secret would make every issued token trivially forgeable.

Optional overrides (all documented in `.env.example`): `GROQ_MODEL`,
`MONGODB_*`, `EMBEDDING_*`, `FRONTEND_ORIGIN`, `JWT_ALGORITHM`,
`JWT_EXPIRE_MINUTES` (default 1440 = 24h), `MAX_UPLOAD_BYTES` (default
10 MB), `RATE_LIMIT_ENABLED`, `LOGIN_RATE_LIMIT`,
`LOGIN_RATE_WINDOW_SECONDS`, `LLM_RATE_LIMIT`, `LLM_RATE_WINDOW_SECONDS`.

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

## 4. Regular (non-vector) indexes

Everything except the vector index is created automatically and
idempotently by `ensure_indexes()` (in `app/db/mongo.py`), called from the
FastAPI lifespan startup handler. Each index is created independently and
failures are logged rather than fatal.

| Collection | Index | Unique | Why |
|---|---|---|---|
| `users` | `email` | yes | Closes the register check-then-insert race; a `DuplicateKeyError` becomes a clean `409`. |
| `matches` | `match_id` | yes | `match_id` is the handle `/email` and `/feedback` use. |
| `matches` | `user_id, timestamp` | no | Per-user match listing (`/matches/all`). |
| `matches` | `mentor_id` | no | Mentor-side match listing. |
| `matches` | `user_id, mentor_id, profile_fingerprint` | yes (partial: `user_id` exists) | De-duplicates repeated `/match` calls. |
| `feedback` | `match_id` | yes | Enforces one feedback per match. |
| `feedback` | `mentor_id` | no | Backs the `effectiveness_score` aggregation. |

## 5. Seed the mentors collection

```bash
python seed_mentors.py
```

This removes previously seeded mentors (every mentor document **without**
a `user_id`) and inserts 15 mentor profiles, each with a
`BAAI/bge-base-en-v1.5` embedding computed from their
domain/stage_focus/expertise (passage-side, no query prefix — see
"Embedding convention" below), a fake contact `email`
(`…@mentors.mentora.dev`), `preferred_stages` and `seeded: true`. Mentors
created through `POST /register` are kept. Re-run it after upgrading so
the seeded mentors pick up their `email` field.

## 6. Run the server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`, with interactive
docs at `http://localhost:8000/docs`. CORS is enabled for
`http://localhost:3000` (the expected frontend origin) by default —
override via `FRONTEND_ORIGIN` in `.env` if needed.

## 7. Run the tests

```bash
./venv/bin/python -m pytest tests/ -q
```

The suite runs fully offline and takes a few seconds: MongoDB is replaced
by `mongomock`, and the embedding model and every Groq call are patched
out. No test touches the real Atlas cluster or the network. It covers
auth, the authorization fixes, match de-duplication and the status
lifecycle, rate limiting, the weighted scoring formula, PDF upload
validation, and the startup config checks.

## API reference

All endpoints except `/`, `/health`, `/register` and `/login` require
`Authorization: Bearer <access_token>`. A missing, malformed, invalid or
expired token returns `401`.

**Error format.** Every error response is JSON with a human-readable
`error` string, plus `detail` for backward compatibility:

```json
{ "error": "Account already exists.", "detail": "Account already exists." }
```

For request-validation failures (`422`), `error` is a joined readable
message (e.g. `"rating: Input should be less than or equal to 5"`) and
`detail` is FastAPI's list of per-field errors. Unhandled exceptions are
logged and answered with a generic `500 {"error": "Internal server
error."}` — tracebacks never reach the client.

### `POST /register`

Auth: none. Body:

```json
{
  "email": "founder@example.com",
  "password": "at-least-8-chars",
  "role": "startup",
  "profile": {}
}
```

- `password`: minimum 8 characters, maximum 72 **bytes** (bcrypt's hard
  limit — longer passwords are rejected with `422` rather than 500-ing).
- `role`: `"startup"` or `"mentor"`.
- For `role: "mentor"`, `profile` is validated and requires only a
  `name` and at least one `sector_expertise` entry (a list, or a
  comma-separated string):
  ```json
  { "name": "Ada Mentor", "sector_expertise": ["FinTech", "SaaS"] }
  ```
  Everything else is optional: `domain` defaults to the first sector,
  `expertise` to the sectors, `stage_focus` (`idea` / `MVP` / `growth` /
  `all`) to `all`. The rest of the profile is collected by the onboarding
  flow (`PATCH /mentor/profile`). The mentor document also stores the
  registering `email` and `onboarding_completed: false`. A mentor
  registration inserts the mentor document **first**, then the user, and
  rolls the mentor document back if the user insert fails, so a failure
  can never leave an orphaned account. The two are cross-linked:
  `users.mentor_id` and `mentors.user_id`.
- Response `200`: `{"access_token": "<jwt>", "token_type": "bearer"}`
- Errors: `409` `"Account already exists."`, `422` invalid payload /
  mentor profile, `502` database failure.

### `POST /login`

Auth: none. Rate-limited (see below). Body:
`{"email": "...", "password": "..."}`

- Response `200`: `{"access_token": "<jwt>", "token_type": "bearer"}`
- Errors: `401` `"Invalid email or password."` (identical for unknown
  email and wrong password), `429` when rate-limited.

### `GET /me`

Auth: required. Response `200`:

```json
{
  "user_id": "665f...",
  "email": "founder@example.com",
  "role": "startup",
  "profile": {},
  "mentor_id": null,
  "created_at": "2026-01-01T00:00:00+00:00"
}
```

The password hash is never returned. Errors: `401`, `404` if the account
was deleted.

### `POST /extract`

Auth: required. Rate-limited per user. `multipart/form-data`, field name
`file` (a PDF, max 10 MB).

- Response `200`:
  ```json
  {
    "domain": "Fintech",
    "stage": "MVP",
    "challenges": ["Customer acquisition cost is high", "Limited runway"],
    "team_gaps": ["No dedicated CTO", "No sales lead"],
    "geography": "San Francisco, CA"
  }
  ```
- Errors: `400` `"Only PDF files are accepted"`, empty or
  corrupt/password-protected file; `413` larger than `MAX_UPLOAD_BYTES`;
  `422` `"Deck appears to be image-based or empty. Please upload a
  text-based PDF."` when fewer than 100 characters of text can be
  extracted; `429` rate-limited; `500` `GROQ_API_KEY` missing, or the
  model's output failed validation twice (the retry uses a stricter
  prompt at temperature 0); `502` Groq unavailable.

### `POST /match`

Auth: required. Body shaped like the `/extract` response:

```json
{
  "domain": "Fintech",
  "stage": "MVP",
  "challenges": ["Customer acquisition cost is high"],
  "team_gaps": ["No dedicated CTO"],
  "geography": "New York, NY"
}
```

- Response `200`:
  ```json
  {
    "matches": [
      {
        "mentor_id": "6a9718513579f7a4ff0d290f",
        "name": "Ava Chen",
        "domain": "Fintech",
        "stage_focus": "MVP",
        "expertise": ["Fundraising", "Product-Market Fit"],
        "match_score": 0.8712,
        "match_id": "0fbb6ece-12d5-4461-8fad-30bc79836ed7",
        "email": "ava.chen@mentors.mentora.dev",
        "geography": "San Francisco, CA",
        "similarity": 0.8231
      }
    ]
  }
  ```
- Each match is persisted in `matches`, stamped with the caller's
  `user_id` from the JWT `sub`, and **upserted** on
  `(user_id, mentor_id, profile_fingerprint)` — the fingerprint being a
  stable SHA-256 of the normalised startup profile. Re-matching the same
  profile therefore refreshes the existing records (keeping their
  `match_id` and `status`) instead of duplicating history and
  double-counting dashboard stats.
- `match_id` is the handle to pass to `/email` and `/feedback`.
- `similarity` is the raw clamped cosine score; `email` is the mentor's
  contact address (if known).
- Errors: `404` `"No mentor profiles found. Please seed the database."`
  when the mentors collection is empty.
- Errors: `401`, `422` invalid profile, `502` vector search unavailable
  (the client sees a generic message; details go to the server log).

### `POST /matches/all`

Auth: required. No body. Returns only the caller's matches:

- a `startup` user sees the matches they created (`user_id == sub`);
- a `mentor` user sees matches pointing at their own mentor record
  (`mentor_id == users.mentor_id`), so they see incoming interest without
  seeing other startups' matches. A mentor account with no linked mentor
  document falls back to its own outgoing matches.

Nobody can read the whole collection. Response `200`:
`{"matches": [ <match document>, ... ]}`, newest first, with `ObjectId`s
and datetimes stringified. Errors: `401`, `502`.

### `GET /mentors`

Auth: required. Query params: `limit` (1-200, default 50), `skip`,
`domain` (case-insensitive exact), `stage_focus`.

```json
{
  "mentors": [
    {
      "mentor_id": "6a9718513579f7a4ff0d290f",
      "name": "Ava Chen",
      "domain": "Fintech",
      "stage_focus": "idea",
      "expertise": ["Fundraising"],
      "geography": "San Francisco, CA",
      "effectiveness_score": 4.5,
      "feedback_count": 2
    }
  ],
  "total": 15
}
```

The `embedding` field is explicitly projected out here and is never
returned by any endpoint.

### `POST /email`

Auth: required. Rate-limited per user. Body:

```json
{
  "startup_profile": { "...": "as for /match" },
  "mentor": { "...": "a MentorMatch object from /match" },
  "match_id": "0fbb6ece-12d5-4461-8fad-30bc79836ed7"
}
```

`match_id` is **optional** (it may also be supplied as `mentor.match_id`),
so existing callers keep working. When present and owned by the caller,
the match advances to status `emailed`.

- Response `200`: `{"subject": "...", "body": "..."}`
- Errors: `401`, `422`, `429`, `503` `"Email generation unavailable.
  Please try again."` for any generation failure (missing
  `GROQ_API_KEY`, Groq error, unusable output after one retry).

### `POST /feedback`

Auth: required. Body:

```json
{
  "match_id": "0fbb6ece-12d5-4461-8fad-30bc79836ed7",
  "mentor_id": "6a9718513579f7a4ff0d290f",
  "attended": true,
  "rating": 4
}
```

Checks performed, in order:

1. `mentor_id` must be a valid ObjectId → else `400`.
2. The `match_id` must exist → else `404`.
3. The match must belong to the caller → else `403`. (Match documents
   written before per-user ownership have no owner and are treated as not
   owned.)
4. The submitted `mentor_id` must equal the match record's `mentor_id` →
   else `400`.
5. **One feedback per match**: a second submission for the same
   `match_id` is rejected with `409` (enforced by a unique index, so it is
   race-free). Feedback therefore cannot be replayed to inflate or deflate
   a mentor's ranking.

On success, the mentor's `effectiveness_score` is recomputed with a
MongoDB `$group`/`$avg` aggregation (not by pulling every feedback
document into Python), `feedback_count` is updated, and the match
advances to `completed`.

- Response `200`: `{"success": true, "new_effectiveness_score": 4.0}`
- Errors: `400`, `401`, `403`, `404`, `409`, `422` (`rating` must be a
  strict integer 1-5 and `attended` a strict JSON boolean — `"3"`, `3.5`,
  `"true"` and `1` are all rejected), `502`.

### `POST /feedback-status`

Auth: required. Body: `{"match_id": "...", "status": "email_sent"}`.
`status` may only be `emailed` or `email_sent` (`completed` is reachable
only through `POST /feedback`) — anything else is `422`.

Forward-only and idempotent: requesting a status the match already
reached or passed returns `200` without changing it. Moving to
`email_sent` also stamps `email_sent_at`.

- Response `200`: `{"success": true, "match_id": "...", "status": "email_sent"}`
  (`status` is what is stored after the call).
- Errors: `401`, `403` not your match, `404` unknown match, `422`.

### `PATCH /mentor/profile`

Auth: required, `role` must be `mentor` (else `403`). Body:

```json
{
  "name": "Ada Mentor",
  "linkedin_url": "https://www.linkedin.com/in/ada",
  "bio": "Up to 300 characters.",
  "geography": "Bangalore",
  "sector_expertise": ["FinTech", "SaaS"],
  "years_experience": "10+",
  "past_exits": "Exited Series B SaaS startup in 2021",
  "preferred_stages": ["MVP", "growth"],
  "max_startups_per_month": "2",
  "availability": "Weekends"
}
```

Allowed values: `geography` ∈ Bangalore, Mumbai, Delhi, Hyderabad,
Chennai, Other; `sector_expertise` (≥ 1) ⊆ Clean Energy, EdTech, FinTech,
HealthTech, AgriTech, SaaS, D2C, DeepTech, Logistics, Others;
`years_experience` ∈ `1-3`, `3-5`, `5-10`, `10+`; `preferred_stages`
(≥ 1) ⊆ `idea`, `MVP`, `growth`, `all`; `max_startups_per_month` ∈ `1`,
`2`, `3`, `5+`; `availability` ∈ Weekdays, Weekends, Flexible.
`linkedin_url` (optional) must be http(s); `bio` and `past_exits` are
optional, max 300 characters.

The mentor document gets `domain = sector_expertise[0]`,
`expertise = sector_expertise`, `stage_focus` = the single chosen stage
(or `all`), a fresh embedding (bio / past exits / experience included in
the embedded text), and `onboarding_completed: true`; the profile is
mirrored onto `users.profile`.

- Response `200`: `{"success": true, "mentor_id": "...", "profile": {...}}`
- Errors: `401`, `403`, `404` no linked mentor document, `422`, `502`.

### `POST /evaluate`

Auth: required. Body:

```json
{
  "startup_profile": { "...": "as for /match" },
  "ground_truth_mentor_ids": ["6a97...", "6a98..."]
}
```

Runs the matching pipeline (without recording match history) and scores
the top 5 with binary relevance (`app/services/evaluation.py`):
precision@5 = hits / 5; recall@5 = hits / |ground truth|; MRR = 1 / rank
of the first relevant mentor; NDCG@5 = DCG / IDCG with
`DCG = Σ rel_i / log2(i + 1)`; `avg_match_score` = mean raw cosine
similarity of the top 5.

- Response `200`:
  ```json
  {
    "precision_at_5": 0.4,
    "recall_at_5": 0.6667,
    "mrr": 0.5,
    "ndcg_at_5": 0.4982,
    "avg_match_score": 0.7,
    "top_5_mentor_ids": ["...", "..."]
  }
  ```
- Errors: `401`, `404` no mentors, `422` (e.g. empty ground truth), `502`.

### `GET /feedback/summary`

Auth: required. Per-mentor aggregates for the dashboard:

```json
{
  "mentors": [
    {
      "mentor_id": "6a9718513579f7a4ff0d290f",
      "name": "Ava Chen",
      "feedback_count": 2,
      "average_rating": 4.5,
      "attended_count": 2
    }
  ]
}
```

### `GET /` and `GET /health`

Auth: none. `{"status": "ok", ...}` / `{"status": "healthy"}`.

## Match status lifecycle

Match documents carry a `status` from this vocabulary, advanced **only
forwards** and only for the owning user (`app/services/matches.py`):

| Status | Set by | Meaning |
|---|---|---|
| `pending` | `POST /match` (on insert) | Matched, no outreach yet. |
| `emailed` | `POST /email` with a `match_id` | An intro email was drafted for this match. |
| `email_sent` | `POST /feedback-status` | The intro email was actually delivered (also sets `email_sent_at`). |
| `completed` | `POST /feedback` | Feedback recorded; the loop is closed. |

`advance_match_status()` only updates a match whose current status is
earlier in that list, so a status never regresses and the frontend's
status badge / "Emails Sent" stats reflect reality.

## Scoring / matching details

- Embeddings: `sentence-transformers` with `BAAI/bge-base-en-v1.5`,
  L2-normalized (`normalize_embeddings=True`), 768 dimensions.
- **Embedding convention (important, and consistent across the whole
  codebase)**: BGE models are trained asymmetrically.
  - Query side (`/match`'s incoming startup profile) is embedded with the
    prefix `"Represent this sentence for searching relevant passages: "`.
  - Passage side (mentor profiles, both in `seed_mentors.py` and at
    mentor registration) is embedded with **no prefix**.
  - Both live in `app/services/embeddings.py` (`embed_query` /
    `embed_passage`) so this convention can't drift.
- Vector search pulls the top 20 raw candidates (`numCandidates` = 200)
  from Atlas, re-ranks them with the weighted formula below, and returns
  the top 5.
- **Weighted formula** (constants at the top of
  `app/services/mentor_matching.py`; the weights sum to 1.0, so
  `match_score` is in `[0, 1]`):

```
final_score = cosine_score              * 0.50
            + stage_match               * 0.20
            + domain_match              * 0.15
            + geography_match           * 0.05
            + effectiveness_normalized  * 0.10
```

  - `cosine_score` — the raw `$vectorSearch` score, clamped to `[0, 1]`.
  - `stage_match` — 1.0 if `mentor.stage_focus == startup.stage`, or the
    startup's stage is in `mentor.preferred_stages`, or the mentor covers
    `all` stages (all case-insensitive), else 0.0.
  - `domain_match` — 1.0 if `mentor.domain == startup.domain`
    (case-insensitive), else 0.0.
  - `geography_match` — 1.0 if both sides have a geography and they match
    (case-insensitive), else 0.0.
  - `effectiveness_normalized` — `(mentor.effectiveness_score or 0) / 5`,
    so mentors with no feedback yet contribute 0. This is the feedback
    loop: `POST /feedback` raises or lowers a mentor's average rating,
    which changes their ranking on subsequent matches.

## Security notes

- **Auth**: bcrypt password hashing, HS256 JWTs (`sub` = user id,
  `role`, `exp`). `JWT_SECRET` is validated at startup (≥ 32 chars, no
  known placeholders) — the process refuses to start otherwise.
- **Per-user scoping**: every match record carries `user_id`;
  `/matches/all` and `/feedback` authorize against it. There is no
  endpoint that returns other users' startup profiles.
- **Rate limiting** (`app/services/rate_limit.py`) — a small in-process
  sliding-window counter:
  | Endpoint | Key | Default limit |
  |---|---|---|
  | `POST /login` | client IP (left-most `X-Forwarded-For`, else peer) | 10 per 5 minutes |
  | `POST /extract` | authenticated user id | 20 per hour |
  | `POST /email` | authenticated user id | 20 per hour |

  Exceeding a limit returns `429` with a `Retry-After` header. **The
  counters live in this process's memory**, which is fine for a single
  uvicorn worker but *not* for a multi-process / multi-instance
  deployment — there each worker would enforce its own separate quota, so
  a shared store (Redis `INCR` + `EXPIRE`) or an API-gateway rate limiter
  should be used instead. Set `RATE_LIMIT_ENABLED=false` to disable.
- **Upload cap**: `/extract` streams the upload in 64 KB chunks and
  aborts with `413` past `MAX_UPLOAD_BYTES` (10 MB), so an oversized PDF
  is never fully buffered nor shipped to Groq.
- **Error hygiene**: internal exception text (driver errors, connection
  strings, Groq payloads) is logged server-side and never included in
  `HTTPException` details.

## Project structure

```
mentora-backend/
  app/
    main.py                  # FastAPI app, CORS, lifespan index creation, routers
    config.py                # pydantic-settings config + fail-fast security checks
    routers/
      auth.py                 # POST /register, POST /login, GET /me
      extract.py              # POST /extract
      match.py                # POST /match, POST /matches/all, GET /mentors
      email.py                # POST /email
      feedback.py             # POST /feedback, POST /feedback-status, GET /feedback/summary
      mentor.py               # PATCH /mentor/profile (mentor onboarding)
      evaluate.py             # POST /evaluate (retrieval metrics)
    services/
      pdf_extract.py          # PyMuPDF text extraction + size cap
      llm.py                  # Groq profile extraction (prompt + JSON validation)
      email_gen.py            # Groq intro-email drafting
      embeddings.py           # sentence-transformers BGE wrapper (singleton)
      mentor_matching.py      # Atlas $vectorSearch query + weighted re-rank
      matches.py              # match de-duplication + status lifecycle
      evaluation.py           # precision/recall/MRR/NDCG metric functions
      auth.py                 # bcrypt hashing + JWT issue/verify
      auth_dependency.py      # get_current_user bearer-token dependency
      rate_limit.py           # in-process sliding-window rate limiting
    models/
      schemas.py              # Pydantic request/response models
    db/
      mongo.py                # pymongo client setup + ensure_indexes()
  tests/                       # offline pytest suite (mongomock, patched Groq)
  seed_mentors.py              # seeds 15 mentor profiles + embeddings
  requirements.txt
  .env.example
  README.md
```

## Notes / limitations

- MongoDB access uses `pymongo` (sync) consistently throughout the app
  and the seed script — no `motor`/async driver is mixed in.
- The Groq calls request JSON mode (`response_format={"type":
  "json_object"}`) and defensively re-validate the result against a
  Pydantic model, retrying once on malformed/invalid JSON (with a stricter
  prompt for `/extract`) before failing (`500` for `/extract`, `503` for
  `/email`).
- Rate limiting is per-process (see Security notes).
- `/email` only *drafts* an email; delivery happens in the frontend
  (Resend, via its `/api/send-email` route), which then calls
  `POST /feedback-status` to move the match to `email_sent`.
- Network calls to Groq and MongoDB Atlas only succeed once you've
  supplied real credentials in `.env` and created the Atlas Vector Search
  index described above.
