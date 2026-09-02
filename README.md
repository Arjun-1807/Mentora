# Mentora

Find the right mentor, automatically. Mentora reads a startup's pitch deck,
extracts a structured profile from it, matches the startup to the best-fit
mentors using vector similarity search, drafts the introduction email, and
learns from how each introduction actually went.

## How it works

1. **Sign up** as a startup or a mentor. Mentors are embedded and indexed on
   registration, so a new mentor is immediately discoverable.
2. **Upload** a pitch deck PDF. Text is extracted with PyMuPDF and structured
   by an LLM into `domain`, `stage`, `challenges`, `team_gaps`, `geography`.
3. **Review** the extracted profile, then ask for matches.
4. **Match** — the profile is embedded with `BAAI/bge-base-en-v1.5` and run
   through MongoDB Atlas `$vectorSearch`, then re-ranked by a weighted score
   combining semantic similarity with stage, domain, and geography fit plus
   each mentor's track record:

   ```
   final_score = cosine       × 0.50
               + stage_match  × 0.20
               + domain_match × 0.15
               + geo_match    × 0.05
               + effectiveness× 0.10
   ```

5. **Reach out** — an LLM drafts a short intro email from the startup to the
   mentor, referencing the startup's actual challenges and the mentor's
   expertise. The draft is editable before it goes anywhere.
6. **Close the loop** — log whether the meeting happened and rate it 1–5.
   That rating rolls into the mentor's `effectiveness_score`, which feeds
   straight back into step 4's ranking for everyone.

The feedback loop in steps 5–6 is the point: matches get better as the system
accumulates evidence about which mentors actually help.

## Structure

- [`mentora-backend/`](./mentora-backend) — FastAPI service. PDF extraction
  (PyMuPDF), profile + email generation via Groq, mentor matching via
  `BAAI/bge-base-en-v1.5` embeddings and MongoDB Atlas Vector Search, JWT
  auth (bcrypt + PyJWT), and the feedback/effectiveness loop.
- [`mentora-frontend/`](./mentora-frontend) — Next.js 14 App Router app
  (JavaScript), shadcn/ui on Tailwind v4, dark-first with a teal accent and
  square corners.

Each subproject's README has the detailed setup, API reference, and notes.

## Quick start

The backend needs a Groq API key, a MongoDB Atlas connection string, and a
JWT signing secret. It also needs an Atlas Vector Search index on the
`mentors` collection — see
[`mentora-backend/README.md`](./mentora-backend/README.md) for the exact index
definition, which cannot be created from application code.

```bash
# Backend → http://localhost:8000 (docs at /docs)
cd mentora-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in GROQ_API_KEY, MONGODB_URI, JWT_SECRET
python seed_mentors.py     # seeds 15 sample mentors (clears the collection)
uvicorn app.main:app --reload --port 8000
```

```bash
# Frontend → http://localhost:3000
cd mentora-frontend
npm install
npm run dev
```

Sample pitch decks for trying the flow end to end live in
[`mentora-backend/test_decks/`](./mentora-backend/test_decks).

> Note: `seed_mentors.py` clears the `mentors` collection before inserting,
> so re-running it will remove mentors created through registration.
