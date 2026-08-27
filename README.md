# Mentora

Find your perfect mentor, automatically. Mentora extracts a structured
profile from a startup's pitch deck (PDF) and matches it to the best-fit
mentors using vector similarity search.

## Structure

- [`mentora-backend/`](./mentora-backend) — FastAPI service: PDF text
  extraction (PyMuPDF), profile extraction via Groq, and mentor matching
  via BAAI/bge-base-en-v1.5 embeddings + MongoDB Atlas Vector Search.
- [`mentora-frontend/`](./mentora-frontend) — Next.js 14 app: landing,
  upload, profile, and matches pages, styled with Tailwind CSS.

See each subproject's own README for setup and run instructions.

## Quick start

```bash
# Backend (http://localhost:8000)
cd mentora-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in GROQ_API_KEY and MONGODB_URI
python seed_mentors.py
uvicorn app.main:app --reload --port 8000

# Frontend (http://localhost:3000)
cd mentora-frontend
npm install
npm run dev
```
