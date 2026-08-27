# Mentora Frontend

A Next.js 14 (App Router) frontend for Mentora, a startup-mentor matching app. Upload a pitch deck, get a structured startup profile, and see your top mentor matches.

## Stack

- Next.js 14 (App Router, JavaScript)
- Tailwind CSS
- No authentication, no server-side data layer — this app talks directly to a FastAPI backend running separately.

## Getting started

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Backend requirement

This frontend expects a backend API to be running at `http://localhost:8000` with two endpoints:

- `POST http://localhost:8000/extract` — accepts a PDF pitch deck as `multipart/form-data` (field name `file`), returns a JSON startup profile (`domain`, `stage`, `challenges`, `team_gaps`).
- `POST http://localhost:8000/match` — accepts the startup profile as JSON, returns mentor matches (either a JSON array, or an object with a `matches` array).

Start the backend separately before using the Upload and Profile pages — this frontend does not start or manage the backend process.

## Pages

- `/` — Landing page with the Mentora tagline and a "Get Matched" CTA.
- `/upload` — Upload a PDF pitch deck and analyze it via the backend.
- `/profile` — View the extracted startup profile and kick off mentor matching.
- `/matches` — View your top 5 mentor matches with match scores.

## Project structure

```
src/
  app/
    layout.js         # Root layout, global metadata + dark navy theme
    page.js            # Landing page
    globals.css         # Tailwind directives + base styles
    upload/page.js       # Upload + analyze pitch deck (client)
    profile/page.js       # Startup profile + find mentors (client)
    matches/page.js        # Mentor match results (client)
  components/
    Navbar.js
    Card.js
    Badge.js
    ScoreBar.js
    Spinner.js
```

## Build

```bash
npm run build
```
